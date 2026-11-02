//! Executes Beam's native-SOL `create_v2`, legacy `buy` and legacy `sell`
//! handlers in a synthetic local bank and checks every curve, lamport and
//! token delta against the program's own pure quote and fee functions.
//!
//! The inherited Pump fee program is replaced by a synthetic processor that
//! returns fixed basis points. Those bps are test inputs, not Beam or Pump
//! fee policy. Nothing here touches a live network, wallet or fee program.
use anchor_lang::{
    prelude::Pubkey, solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, program::set_return_data},
    AccountDeserialize, AccountSerialize, AnchorSerialize, InstructionData, ToAccountMetas,
};
use anchor_spl::{
    associated_token::{get_associated_token_address_with_program_id as ata, spl_associated_token_account},
    token_2022::spl_token_2022::{self, extension::StateWithExtensions, state::{Account as TokenAccount, Mint}},
};
use beam_program::{
    buy_quote, fee_math::fee, pump_fees::{accounts::FeeConfig, types::Fees},
    trade_types::BondingCurve, Global, GlobalVolumeAccumulator, OptionBool, PumpError, CreationOptionU64,
};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account, instruction::{AccountMeta, Instruction, InstructionError}, rent::Rent,
    signature::{Keypair, Signer}, system_program, transaction::{Transaction, TransactionError},
};

const FEE_PROGRAM: Pubkey = beam_program::pump_fees::ID;
const MAYHEM: Pubkey = beam_program::mayhem::ID;
const PROTOCOL_BPS: u64 = 95;
const CREATOR_BPS: u64 = 30;
const BUYBACK_BPS: u64 = 2_000;
const INITIAL_VIRTUAL_TOKENS: u64 = 1_073_000_000_000_000;
const INITIAL_VIRTUAL_SOL: u64 = 30_000_000_000;
const INITIAL_REAL_TOKENS: u64 = 793_100_000_000_000;
const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000;
const GET_FEES_WITH_QUOTE_MINT: [u8; 8] = [154, 237, 138, 92, 162, 2, 162, 187];

fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey { Pubkey::find_program_address(seeds, program).0 }
fn global_pda() -> Pubkey { pda(&[b"global"], &beam_program::ID) }
fn curve_pda(mint: &Pubkey) -> Pubkey { pda(&[b"bonding-curve", mint.as_ref()], &beam_program::ID) }
fn creator_vault(creator: &Pubkey) -> Pubkey { pda(&[b"creator-vault", creator.as_ref()], &beam_program::ID) }
fn event_authority() -> Pubkey { pda(&[b"__event_authority"], &beam_program::ID) }
fn fee_config_pda() -> Pubkey { pda(&[b"fee_config", beam_program::ID.as_ref()], &FEE_PROGRAM) }

fn beam_processor<'a>(program_id: &Pubkey, accounts: &[AccountInfo<'a>], data: &[u8]) -> ProgramResult {
    // SAFETY: ProgramTest invokes the processor synchronously and neither side
    // retains the slice; Anchor's entrypoint requires the shared lifetime.
    let accounts: &'a [AccountInfo<'a>] = unsafe { std::mem::transmute(accounts) };
    beam_program::entry(program_id, accounts, data)
}

/// Synthetic stand-in for the inherited fee program's `get_fees_with_quote_mint`.
fn fee_processor(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    assert_eq!(&data[..8], &GET_FEES_WITH_QUOTE_MINT, "unexpected fee instruction");
    assert_eq!(data.len(), 8 + 1 + 16 + 32, "bool, u128 market cap, quote mint");
    assert_eq!(data[8], 1, "legacy trades query with is_pump_pool = true");
    assert!(u128::from_le_bytes(data[9..25].try_into().unwrap()) > 0, "market cap is positive");
    assert_eq!(&data[25..57], Pubkey::default().as_ref(), "native SOL quote mint");
    assert_eq!(*accounts[0].key, fee_config_pda());
    assert_eq!(*accounts[1].key, beam_program::ID);
    let fees = Fees { lp_fee_bps: 0, protocol_fee_bps: PROTOCOL_BPS, creator_fee_bps: CREATOR_BPS };
    set_return_data(&fees.try_to_vec().unwrap());
    Ok(())
}

fn owned(data: Vec<u8>, owner: Pubkey) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner, executable: false, rent_epoch: 0 }
}
fn wallet(lamports: u64) -> Account {
    Account { lamports, data: vec![], owner: system_program::ID, executable: false, rent_epoch: 0 }
}

struct Bank {
    ctx: ProgramTestContext,
    user: Keypair,
    creator: Pubkey,
    fee_recipient: Pubkey,
    buyback: Pubkey,
    stranger: Pubkey,
    mint: Keypair,
}

async fn bank() -> Bank {
    let user = Keypair::new();
    let creator = Pubkey::new_unique();
    let fee_recipient = Pubkey::new_unique();
    let buyback = Pubkey::new_unique();
    let stranger = Pubkey::new_unique();

    let zeroed = vec![0u8; 4_096];
    let mut global = Global::try_deserialize_unchecked(&mut &zeroed[..]).unwrap();
    global.initialized = true;
    global.authority = Pubkey::new_unique();
    global.fee_recipient = fee_recipient;
    global.initial_virtual_token_reserves = INITIAL_VIRTUAL_TOKENS;
    global.initial_virtual_sol_reserves = INITIAL_VIRTUAL_SOL;
    global.initial_real_token_reserves = INITIAL_REAL_TOKENS;
    global.token_total_supply = TOTAL_SUPPLY;
    global.create_v2_enabled = true;
    global.whitelist_pda = Pubkey::new_unique();
    global.buyback_fee_recipients = [buyback; 8];
    global.buyback_basis_points = BUYBACK_BPS;
    let mut global_data = Vec::new();
    global.try_serialize(&mut global_data).unwrap();

    let zeroed_volume = vec![0u8; 1_024];
    let volume = GlobalVolumeAccumulator::try_deserialize_unchecked(&mut &zeroed_volume[..]).unwrap();
    let mut volume_data = Vec::new();
    volume.try_serialize(&mut volume_data).unwrap();

    let empty = Fees { lp_fee_bps: 0, protocol_fee_bps: 0, creator_fee_bps: 0 };
    let config = FeeConfig {
        bump: 0, admin: Pubkey::default(), flat_fees: empty.clone(),
        fee_tiers: vec![], stable_fee_tiers: vec![], exotic_flat_fees: empty,
    };
    let mut config_data = Vec::new();
    config.try_serialize(&mut config_data).unwrap();

    let mut test = ProgramTest::new("beam_program", beam_program::ID, processor!(beam_processor));
    test.add_program("synthetic_fee_program", FEE_PROGRAM, processor!(fee_processor));
    test.add_account(global_pda(), owned(global_data, beam_program::ID));
    test.add_account(pda(&[b"global_volume_accumulator"], &beam_program::ID), owned(volume_data, beam_program::ID));
    test.add_account(fee_config_pda(), owned(config_data, FEE_PROGRAM));
    test.add_account(user.pubkey(), wallet(100_000_000_000));
    // Pre-funded so that small fee transfers never leave them below rent.
    test.add_account(fee_recipient, wallet(1_000_000_000));
    test.add_account(buyback, wallet(1_000_000_000));
    test.add_account(stranger, wallet(1_000_000_000));
    Bank { ctx: test.start_with_context().await, user, creator, fee_recipient, buyback, stranger, mint: Keypair::new() }
}

impl Bank {
    async fn send(&mut self, instructions: &[Instruction], extra: &[&Keypair]) -> Result<(), BanksClientError> {
        let blockhash = self.ctx.banks_client.get_latest_blockhash().await.unwrap();
        let mut signers: Vec<&Keypair> = vec![&self.ctx.payer, &self.user];
        signers.extend_from_slice(extra);
        let tx = Transaction::new_signed_with_payer(instructions, Some(&self.ctx.payer.pubkey()), &signers, blockhash);
        self.ctx.banks_client.process_transaction(tx).await
    }
    async fn lamports(&mut self, key: Pubkey) -> u64 {
        self.ctx.banks_client.get_account(key).await.unwrap().map_or(0, |a| a.lamports)
    }
    async fn curve(&mut self) -> BondingCurve {
        let data = self.ctx.banks_client.get_account(curve_pda(&self.mint.pubkey())).await.unwrap().unwrap().data;
        BondingCurve::try_deserialize(&mut &data[..]).unwrap()
    }
    async fn token_balance(&mut self, owner: &Pubkey) -> u64 {
        let key = ata(owner, &self.mint.pubkey(), &spl_token_2022::ID);
        let data = self.ctx.banks_client.get_account(key).await.unwrap().unwrap().data;
        StateWithExtensions::<TokenAccount>::unpack(&data).unwrap().base.amount
    }

    fn create_v2(&self) -> Instruction {
        let mint = self.mint.pubkey();
        let curve = curve_pda(&mint);
        let accounts = beam_program::accounts::CreateV2 {
            mint, mint_authority: pda(&[b"mint-authority"], &beam_program::ID), bonding_curve: curve,
            associated_bonding_curve: ata(&curve, &mint, &spl_token_2022::ID), global: global_pda(),
            user: self.user.pubkey(), system_program: system_program::ID, token_program: spl_token_2022::ID,
            associated_token_program: spl_associated_token_account::ID, mayhem_program_id: MAYHEM,
            global_params: pda(&[b"global-params"], &MAYHEM), sol_vault: pda(&[b"sol-vault"], &MAYHEM),
            mayhem_state: pda(&[b"mayhem-state", mint.as_ref()], &MAYHEM),
            mayhem_token_vault: Pubkey::new_unique(), event_authority: event_authority(), program: beam_program::ID,
        };
        Instruction {
            program_id: beam_program::ID,
            accounts: accounts.to_account_metas(None),
            data: beam_program::instruction::CreateV2 {
                name: "Beam Runtime".into(), symbol: "BRT".into(), uri: "https://example.invalid/brt.json".into(),
                creator: self.creator, is_mayhem_mode: false, is_cashback_enabled: OptionBool(false),
                creator_fee_bps: CreationOptionU64(0), is_holder_reward: OptionBool(false),
            }.data(),
        }
    }

    fn create_user_ata(&self) -> Instruction {
        spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            &self.user.pubkey(), &self.user.pubkey(), &self.mint.pubkey(), &spl_token_2022::ID,
        )
    }

    /// Base metas from Anchor, plus the two remaining accounts the handlers
    /// read: `[bonding-curve-v2 PDA, buyback fee recipient]`.
    fn trade_metas(&self, buy: bool, fee_recipient: Pubkey, vault_creator: Pubkey, remaining: bool) -> Vec<AccountMeta> {
        let mint = self.mint.pubkey();
        let curve = curve_pda(&mint);
        let user = self.user.pubkey();
        let mut metas = if buy {
            beam_program::accounts::LegacyBuy {
                global: global_pda(), fee_recipient, mint, bonding_curve: curve,
                associated_bonding_curve: ata(&curve, &mint, &spl_token_2022::ID),
                associated_user: ata(&user, &mint, &spl_token_2022::ID), user,
                system_program: system_program::ID, token_program: spl_token_2022::ID,
                creator_vault: creator_vault(&vault_creator), event_authority: event_authority(), program: beam_program::ID,
                global_volume_accumulator: pda(&[b"global_volume_accumulator"], &beam_program::ID),
                user_volume_accumulator: pda(&[b"user_volume_accumulator", user.as_ref()], &beam_program::ID),
                fee_config: fee_config_pda(), fee_program: FEE_PROGRAM,
            }.to_account_metas(None)
        } else {
            beam_program::accounts::LegacySell {
                global: global_pda(), fee_recipient, mint, bonding_curve: curve,
                associated_bonding_curve: ata(&curve, &mint, &spl_token_2022::ID),
                associated_user: ata(&user, &mint, &spl_token_2022::ID), user,
                system_program: system_program::ID, creator_vault: creator_vault(&vault_creator),
                token_program: spl_token_2022::ID, event_authority: event_authority(), program: beam_program::ID,
                fee_config: fee_config_pda(), fee_program: FEE_PROGRAM,
            }.to_account_metas(None)
        };
        if remaining {
            metas.push(AccountMeta::new_readonly(pda(&[b"bonding-curve-v2", mint.as_ref()], &beam_program::ID), false));
            metas.push(AccountMeta::new(self.buyback, false));
        }
        metas
    }

    fn buy(&self, amount: u64, max_sol_cost: u64, partial_fill: bool) -> Instruction {
        self.buy_with(amount, max_sol_cost, partial_fill, self.fee_recipient, self.creator, true)
    }
    fn buy_with(&self, amount: u64, max_sol_cost: u64, partial_fill: bool, fee_recipient: Pubkey, vault_creator: Pubkey, remaining: bool) -> Instruction {
        Instruction {
            program_id: beam_program::ID,
            accounts: self.trade_metas(true, fee_recipient, vault_creator, remaining),
            data: beam_program::instruction::Buy {
                amount, max_sol_cost, track_volume: OptionBool(false), partial_fill: OptionBool(partial_fill),
            }.data(),
        }
    }
    fn sell(&self, amount: u64, min_sol_output: u64) -> Instruction {
        Instruction {
            program_id: beam_program::ID,
            accounts: self.trade_metas(false, self.fee_recipient, self.creator, true),
            data: beam_program::instruction::Sell { amount, min_sol_output }.data(),
        }
    }
}

fn custom_error(result: Result<(), BanksClientError>) -> u32 {
    match result.expect_err("transaction must fail").unwrap() {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!("unexpected error {other:?}"),
    }
}
fn code(error: PumpError) -> u32 { error.into() }

struct Expected { cost: u64, protocol: u64, creator: u64, buyback: u64 }
fn expected_fees(quote: u64) -> Expected {
    let protocol = fee(quote, PROTOCOL_BPS).unwrap();
    let creator = fee(quote, CREATOR_BPS).unwrap();
    let buyback = u64::try_from(u128::from(BUYBACK_BPS) * u128::from(protocol) / 10_000).unwrap();
    Expected { cost: quote, protocol, creator, buyback }
}

#[tokio::test]
async fn create_buy_sell_match_pure_quote_and_fee_math() {
    let mut b = bank().await;
    let mint = b.mint.insecure_clone();
    b.send(&[b.create_v2()], &[&mint]).await.expect("create_v2");

    let curve = b.curve().await;
    assert_eq!((curve.virtual_token_reserves, curve.virtual_quote_reserves), (INITIAL_VIRTUAL_TOKENS, INITIAL_VIRTUAL_SOL));
    assert_eq!((curve.real_token_reserves, curve.real_quote_reserves), (INITIAL_REAL_TOKENS, 0));
    assert_eq!((curve.creator, curve.quote_mint, curve.complete), (b.creator, Pubkey::default(), false));
    assert_eq!(b.token_balance(&curve_pda(&b.mint.pubkey())).await, TOTAL_SUPPLY);
    let mint_data = b.ctx.banks_client.get_account(b.mint.pubkey()).await.unwrap().unwrap().data;
    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_data).unwrap().base;
    assert_eq!((mint_state.supply, mint_state.decimals), (TOTAL_SUPPLY, 6));
    assert!(mint_state.mint_authority.is_none(), "mint authority is revoked after creation");

    // ---- buy: max_sol_cost exactly at the bound succeeds, one lamport less fails.
    let amount = 35_000_000_000_000;
    let quote = u64::try_from(buy_quote(&curve, amount).unwrap()).unwrap();
    let fees = expected_fees(quote);
    let total = fees.cost + fees.protocol + fees.creator;
    let ata_ix = b.create_user_ata();
    b.send(&[ata_ix.clone()], &[]).await.unwrap();
    assert_eq!(custom_error(b.send(&[b.buy(amount, total - 1, false)], &[]).await), code(PumpError::TooMuchSolRequired));

    let curve_key = curve_pda(&b.mint.pubkey());
    let vault = creator_vault(&b.creator);
    let before = (b.lamports(curve_key).await, b.lamports(b.fee_recipient).await, b.lamports(b.buyback).await, b.lamports(vault).await);
    b.send(&[b.buy(amount, total, false)], &[]).await.expect("buy at exact bound");
    let after = (b.lamports(curve_key).await, b.lamports(b.fee_recipient).await, b.lamports(b.buyback).await, b.lamports(vault).await);
    assert_eq!(after.0 - before.0, fees.cost, "curve receives the quote");
    assert_eq!(after.1 - before.1, fees.protocol - fees.buyback, "fee recipient receives the protocol remainder");
    assert_eq!(after.2 - before.2, fees.buyback, "buyback recipient receives its share");
    assert_eq!(after.3 - before.3, Rent::default().minimum_balance(0) + fees.creator, "creator vault: rent top-up then creator fee");
    assert_eq!(b.token_balance(&b.user.pubkey()).await, amount);
    let bought = b.curve().await;
    assert_eq!(bought.virtual_token_reserves, curve.virtual_token_reserves - amount);
    assert_eq!(bought.real_token_reserves, curve.real_token_reserves - amount);
    assert_eq!(bought.virtual_quote_reserves, curve.virtual_quote_reserves + fees.cost);
    assert_eq!(bought.real_quote_reserves, fees.cost);

    // ---- sell: min_sol_output exactly at the bound succeeds, one lamport more fails.
    let sold = amount / 2;
    let gross = u64::try_from(bought.sell_quote(sold).unwrap()).unwrap();
    let fees = expected_fees(gross);
    let net = gross - fees.protocol - fees.creator;
    assert_eq!(custom_error(b.send(&[b.sell(sold, net + 1)], &[]).await), code(PumpError::TooLittleSolReceived));
    let user_before = b.lamports(b.user.pubkey()).await;
    let before = (b.lamports(curve_key).await, b.lamports(b.fee_recipient).await, b.lamports(b.buyback).await, b.lamports(vault).await);
    b.send(&[b.sell(sold, net)], &[]).await.expect("sell at exact bound");
    let after = (b.lamports(curve_key).await, b.lamports(b.fee_recipient).await, b.lamports(b.buyback).await, b.lamports(vault).await);
    assert_eq!(b.lamports(b.user.pubkey()).await - user_before, net, "user receives gross minus fees");
    assert_eq!(before.0 - after.0, gross, "curve pays the gross quote");
    assert_eq!(after.1 - before.1, fees.protocol - fees.buyback);
    assert_eq!(after.2 - before.2, fees.buyback);
    assert_eq!(after.3 - before.3, fees.creator);
    assert_eq!(b.token_balance(&b.user.pubkey()).await, amount - sold);
    let after_sell = b.curve().await;
    assert_eq!(after_sell.virtual_token_reserves, bought.virtual_token_reserves + sold);
    assert_eq!(after_sell.virtual_quote_reserves, bought.virtual_quote_reserves - gross);
    assert_eq!(after_sell.real_quote_reserves, bought.real_quote_reserves - gross);
}

#[tokio::test]
async fn partial_fill_clamps_to_real_reserves_and_completes_the_curve() {
    let mut b = bank().await;
    let mint = b.mint.insecure_clone();
    b.send(&[b.create_v2(), b.create_user_ata()], &[&mint]).await.expect("create_v2");
    let curve = b.curve().await;
    let quote = u64::try_from(buy_quote(&curve, curve.real_token_reserves).unwrap()).unwrap();
    let fees = expected_fees(quote);
    let total = fees.cost + fees.protocol + fees.creator;

    assert_eq!(custom_error(b.send(&[b.buy(INITIAL_REAL_TOKENS + 1, u64::MAX, false)], &[]).await), code(PumpError::NotEnoughTokensToBuy));
    b.send(&[b.buy(INITIAL_REAL_TOKENS + 1, total, true)], &[]).await.expect("partial fill buy");
    let done = b.curve().await;
    assert_eq!(b.token_balance(&b.user.pubkey()).await, INITIAL_REAL_TOKENS);
    assert_eq!(done.real_token_reserves, 0);
    assert!(done.complete, "curve completes when real token reserves reach zero");
    assert_eq!(custom_error(b.send(&[b.buy(1, u64::MAX, true)], &[]).await), code(PumpError::BondingCurveComplete));
    assert_eq!(custom_error(b.send(&[b.sell(1, 0)], &[]).await), code(PumpError::BondingCurveComplete));
}

#[tokio::test]
async fn trades_reject_missing_remaining_accounts_and_substituted_recipients() {
    let mut b = bank().await;
    let mint = b.mint.insecure_clone();
    b.send(&[b.create_v2(), b.create_user_ata()], &[&mint]).await.expect("create_v2");
    let (fee_recipient, creator, stranger) = (b.fee_recipient, b.creator, b.stranger);

    // The 16 base metas alone (what the SDK builder returns) are not executable.
    let base_only = b.buy_with(1_000_000, u64::MAX, false, fee_recipient, creator, false);
    assert_eq!(custom_error(b.send(&[base_only], &[]).await), code(PumpError::BuybackFeeRecipientMissing));
    let wrong_recipient = b.buy_with(1_000_000, u64::MAX, false, stranger, creator, true);
    assert_eq!(custom_error(b.send(&[wrong_recipient], &[]).await), code(PumpError::NotAuthorized));
    let wrong_vault = b.buy_with(1_000_000, u64::MAX, false, fee_recipient, stranger, true);
    let seeds: u32 = anchor_lang::error::ErrorCode::ConstraintSeeds.into();
    assert_eq!(custom_error(b.send(&[wrong_vault], &[]).await), seeds);
    assert_eq!(custom_error(b.send(&[b.buy(0, u64::MAX, false)], &[]).await), code(PumpError::BuyZeroAmount));
    assert_eq!(custom_error(b.send(&[b.sell(0, 0)], &[]).await), code(PumpError::SellZeroAmount));
}

//! Executes Beam's native-SOL `create_v2`, legacy `buy` and legacy `sell`
//! handlers in a synthetic local bank and checks every curve, lamport and
//! token delta against the program's own pure quote and fee functions.
//!
//! The inherited Pump fee program is replaced by a synthetic processor that
//! returns fixed basis points. Those bps are test inputs, not Beam or Pump
//! fee policy. Nothing here touches a live network, wallet or fee program.
mod common;

use common::*;
use anchor_lang::{prelude::Pubkey, InstructionData, ToAccountMetas};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id as ata,
    token_2022::spl_token_2022::{self, extension::StateWithExtensions, state::Mint},
};
use beam_program::{buy_quote, OptionBool, PumpError};
use solana_sdk::{
    instruction::{AccountMeta, Instruction}, rent::Rent, signature::Signer, system_program,
};

impl Bank {
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

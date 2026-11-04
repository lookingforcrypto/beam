//! What does a native-SOL `create_v2` launch cost the creator? Runs the real
//! handler in the synthetic local bank and checks that the creator's lamport
//! debit is exactly the rent of the accounts it creates: the Token-2022 mint
//! (with its metadata pointer and on-mint metadata), the bonding curve, and
//! the curve's token account. Transaction fees are paid by the separate test
//! payer and are reported separately.
//!
//! The ignored producer prints the observations in `fixtures/launch-cost.json`,
//! which `web/tests/launchCost.test.ts` checks `web/src/launchCost.ts` against:
//!
//!   cargo test --locked --test launch_cost -- --ignored --nocapture | sed -n 's/^@@//p'
mod common;

use common::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id as ata,
    token_2022::spl_token_2022,
};
use solana_sdk::{rent::Rent, signature::{Keypair, Signer}};

struct Launch { creator_debit: u64, payer_debit: u64, mint_len: usize, mint: u64, curve_len: usize, curve: u64, ata_len: usize, ata: u64 }

async fn launch(b: &mut Bank, name: &str, symbol: &str, uri: &str) -> Launch {
    b.mint = Keypair::new();
    let mint = b.mint.insecure_clone();
    let user = b.user.pubkey();
    let payer = b.ctx.payer.pubkey();
    let (user_before, payer_before) = (b.lamports(user).await, b.lamports(payer).await);
    b.send(&[b.create_v2_with(name, symbol, uri)], &[&mint]).await.expect("create_v2");
    let (user_after, payer_after) = (b.lamports(user).await, b.lamports(payer).await);
    let curve_key = curve_pda(&mint.pubkey());
    let get = |key| { let banks = b.ctx.banks_client.clone(); async move { let mut c = banks; c.get_account(key).await.unwrap().unwrap() } };
    let mint_account = get(mint.pubkey()).await;
    let curve_account = get(curve_key).await;
    let ata_account = get(ata(&curve_key, &mint.pubkey(), &spl_token_2022::ID)).await;
    Launch {
        creator_debit: user_before - user_after,
        payer_debit: payer_before - payer_after,
        mint_len: mint_account.data.len(), mint: mint_account.lamports,
        curve_len: curve_account.data.len(), curve: curve_account.lamports,
        ata_len: ata_account.data.len(), ata: ata_account.lamports,
    }
}

const CASES: [(&str, &str, &str); 6] = [
    ("Beam Runtime", "BRT", "https://example.invalid/brt.json"),
    ("A", "B", ""),
    ("Thirty-two bytes of token name!!", "THIRTEENBYTES", "https://example.invalid/a-much-longer-metadata-location/token.json"),
    ("Beam 🚀", "Ü", "ipfs://bafy"),
    ("x", "yy", "https://example.invalid/"),
    ("Cosmic Cat", "COSMIC", "https://example.invalid/0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789.json"),
];

#[tokio::test]
async fn create_v2_debits_the_creator_exactly_the_new_accounts_rent() {
    let mut b = bank().await;
    let rent = Rent::default();
    for (name, symbol, uri) in CASES {
        let l = launch(&mut b, name, symbol, uri).await;
        let label = format!("{name:?}/{symbol:?}/{uri:?}");
        // Every created account is funded to exactly its rent-exempt minimum.
        assert_eq!(l.mint, rent.minimum_balance(l.mint_len), "{label}: mint");
        assert_eq!(l.curve, rent.minimum_balance(l.curve_len), "{label}: curve");
        assert_eq!(l.ata, rent.minimum_balance(l.ata_len), "{label}: curve token account");
        assert_eq!((l.curve_len, l.ata_len), (166, 170), "{label}: fixed account sizes");
        // The creator pays that rent and nothing else.
        assert_eq!(l.creator_debit, l.mint + l.curve + l.ata, "{label}: creator debit is rent only");
        // Mint size: Token-2022 base with the metadata pointer (234 bytes) plus
        // the on-mint metadata TLV (4 + 80 + the three UTF-8 lengths).
        assert_eq!(l.mint_len, 318 + name.len() + symbol.len() + uri.len(), "{label}: mint size");
        // The separate test payer pays only signature fees (payer, creator, mint).
        assert_eq!(l.payer_debit, 3 * 5_000, "{label}: fee payer");
    }
}

#[tokio::test]
#[ignore = "fixture producer; run explicitly with --ignored --nocapture"]
async fn print_launch_cost_observations() {
    let mut b = bank().await;
    println!("@@{{\"provenance\":\"observed execution of create_v2 in tests/legacy-trade-runtime (native processor, default Rent, 5000 lamports per signature)\",\"cases\":[");
    for (index, (name, symbol, uri)) in CASES.iter().enumerate() {
        let l = launch(&mut b, name, symbol, uri).await;
        println!(
            "@@{}{{\"nameBytes\":{},\"symbolBytes\":{},\"uriBytes\":{},\"mintDataLength\":{},\"mintLamports\":{},\"curveLamports\":{},\"curveTokenAccountLamports\":{},\"creatorDebitLamports\":{}}}",
            if index == 0 { "" } else { "," },
            name.len(), symbol.len(), uri.len(), l.mint_len, l.mint, l.curve, l.ata, l.creator_debit
        );
    }
    println!("@@]}}");
}

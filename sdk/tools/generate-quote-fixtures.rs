//! Host-only bonding-curve quote fixture producer. No handler, wallet, RPC or
//! transaction. Run as an example of the existing, locked beam-program package
//! (copy to programs/beam/examples/beam_quote_fixture.rs, run, then delete):
//!
//!   cargo run --locked --manifest-path programs/beam/Cargo.toml --example beam_quote_fixture
//!
//! Calls the program's own pure functions: `buy_quote`,
//! `BondingCurve::sell_quote`, `tokens_for_quote`, `fee_math::fee` and
//! `fee_math::get_fees` (the local composition that `trade_fees` repeats after
//! the fee CPI). Fee bps are synthetic inputs, not Beam or Pump policy.
use anchor_lang::{prelude::Pubkey, AccountDeserialize};
use beam_program::{
    buy_quote, fee_math, pump_fees::{accounts::FeeConfig, types::{FeeTier, Fees}},
    tokens_for_quote, trade_types::BondingCurve, Global,
};

fn curve(vt: u64, vq: u64, rt: u64, rq: u64, creator: Pubkey, creator_fee_bps: u64) -> BondingCurve {
    BondingCurve {
        virtual_token_reserves: vt, virtual_quote_reserves: vq,
        real_token_reserves: rt, real_quote_reserves: rq,
        token_total_supply: 1_000_000_000_000_000, complete: false, creator,
        is_mayhem_mode: false, is_cashback_coin: false, quote_mint: Pubkey::default(),
        creator_fee_bps, can_edit_creator_fee: false, is_holder_reward: false,
        creator_fee: 0, protocol_fees: 0, depth: 0, initial_virtual_quote_reserves: vq,
        post_complete_base_out: 0, post_complete_quote_in: 0,
    }
}
fn out(result: anchor_lang::Result<u128>) -> String {
    match result {
        Ok(value) => format!("\"{value}\""),
        Err(anchor_lang::error::Error::AnchorError(e)) => format!("{{\"error\":\"{}\"}}", e.error_name),
        Err(e) => format!("{{\"error\":\"{e:?}\"}}"),
    }
}
fn sep(first: &mut bool) -> &'static str { if std::mem::replace(first, false) { "" } else { "," } }

fn main() {
    let creator = Pubkey::new_from_array([7; 32]);
    let curves: [(&str, u64, u64, u64, u64); 9] = [
        ("launch", 1_073_000_000_000_000, 30_000_000_000, 793_100_000_000_000, 0),
        ("mid", 600_000_000_000_000, 53_650_000_000, 320_100_000_000_000, 23_650_000_000),
        ("nearComplete", 279_900_000_000_001, 115_005_359_056, 1, 85_005_359_056),
        ("tiny", 1, 1, 1, 0),
        ("two", 2, 3, 2, 0),
        ("maxReserves", u64::MAX, u64::MAX, u64::MAX, 0),
        ("zeroQuote", 1_000, 0, 1_000, 0),
        ("zeroToken", 0, 1_000, 0, 0),
        ("empty", 0, 0, 0, 0),
    ];
    let amounts: [u64; 12] = [
        0, 1, 2, 1_000_000, 1_000_000_000, 35_000_000_000_000, 279_900_000_000_000,
        793_100_000_000_000, 1_072_999_999_999_999, 1_073_000_000_000_000, 1_073_000_000_000_001, u64::MAX,
    ];

    println!("{{\"provenance\":\"beam-program buy_quote, BondingCurve::sell_quote, tokens_for_quote, fee_math::fee and fee_math::get_fees via the locked crate; synthetic inputs only\",");
    println!("\"curves\":[");
    let mut first = true;
    for (name, vt, vq, rt, rq) in curves {
        let c = curve(vt, vq, rt, rq, creator, 0);
        print!("{}{{\"name\":\"{name}\",\"virtualTokenReserves\":\"{vt}\",\"virtualQuoteReserves\":\"{vq}\",\"realTokenReserves\":\"{rt}\",\"realQuoteReserves\":\"{rq}\",\"cases\":[", sep(&mut first));
        let mut inner = true;
        for amount in amounts {
            print!(
                "{}{{\"amount\":\"{amount}\",\"buyQuote\":{},\"sellQuote\":{},\"tokensForQuote\":{}}}",
                sep(&mut inner), out(buy_quote(&c, amount)), out(c.sell_quote(amount)), out(tokens_for_quote(&c, amount))
            );
        }
        println!("]}}");
    }
    println!("],");

    println!("\"fees\":[");
    let mut first = true;
    for amount in [0u64, 1, 99, 100, 101, 9_999, 10_000, 1_000_000_007, 30_000_000_000, u64::MAX] {
        for bps in [0u64, 1, 30, 50, 93, 95, 100, 9_999, 10_000, 10_001, u64::MAX] {
            let value = fee_math::fee(amount, bps).map(u128::from);
            println!("{}{{\"amount\":\"{amount}\",\"basisPoints\":\"{bps}\",\"fee\":{}}}", sep(&mut first), out(value));
        }
    }
    println!("],");

    // Zeroed Global with only the creator-fee flag toggled; get_fees reads no other field.
    let zeroed = vec![0u8; 16_384];
    println!("\"tradeFees\":[");
    let mut first = true;
    for configurable in [false, true] {
        let mut global = Global::try_deserialize_unchecked(&mut &zeroed[..]).expect("zeroed Global");
        global.creator_fee_configurable = configurable;
        for curve_creator in [Pubkey::default(), creator] {
            for curve_creator_bps in [0u64, 77] {
                for (protocol_bps, creator_bps) in [(93u64, 30u64), (95, 5), (0, 0), (10_000, 10_000)] {
                    let tier = FeeTier {
                        market_cap_lamports_threshold: 0,
                        fees: Fees { lp_fee_bps: 0, protocol_fee_bps: protocol_bps, creator_fee_bps: creator_bps },
                    };
                    let config = FeeConfig {
                        bump: 0, admin: Pubkey::default(),
                        flat_fees: Fees { lp_fee_bps: 0, protocol_fee_bps: 0, creator_fee_bps: 0 },
                        fee_tiers: vec![tier], stable_fee_tiers: vec![],
                        exotic_flat_fees: Fees { lp_fee_bps: 0, protocol_fee_bps: 0, creator_fee_bps: 0 },
                    };
                    let c = curve(1, 1, 1, 0, curve_creator, curve_creator_bps);
                    for amount in [0u64, 1, 333_333_333, 30_000_000_000, u64::MAX / 10_000] {
                        let f = fee_math::get_fees(&global, &c, &config, 2_512, 0, amount).expect("synthetic fees");
                        println!(
                            "{}{{\"creatorFeeConfigurable\":{configurable},\"creator\":\"{curve_creator}\",\"curveCreatorFeeBps\":\"{curve_creator_bps}\",\"protocolFeeBps\":\"{protocol_bps}\",\"creatorFeeBps\":\"{creator_bps}\",\"quoteAmount\":\"{amount}\",\"protocolFee\":\"{}\",\"creatorFee\":\"{}\",\"effectiveProtocolFeeBps\":\"{}\",\"effectiveCreatorFeeBps\":\"{}\"}}",
                            sep(&mut first), f.protocol_fee, f.creator_fee, f.protocol_fee_bps, f.creator_fee_bps
                        );
                    }
                }
            }
        }
    }
    println!("]}}");
}

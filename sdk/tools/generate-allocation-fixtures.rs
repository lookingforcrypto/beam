//! Host-only Beam fee-allocation fixture producer. No handler, wallet, RPC or
//! transaction. Run as an example of the existing, locked beam-program package
//! (copy to programs/beam/examples/beam_allocation_fixture.rs, run, then delete):
//!
//!   cargo run --locked --manifest-path programs/beam/Cargo.toml --example beam_allocation_fixture
//!
//! Calls `beam_program::beam_economics::allocate`, the selected 50-bps
//! component arithmetic. It is not wired into trade collection.
use beam_program::beam_economics::{allocate, COMMUNITY_NOMINAL_BPS, FOUNDER_NOMINAL_BPS, TOTAL_FEE_BPS, TREASURY_NOMINAL_BPS};

fn main() {
    let mut amounts: Vec<u64> = vec![
        0, 1, 2, 3, 199, 200, 201, 333, 1_800, 1_801, 2_000, 3_199, 3_200, 3_201, 9_999, 10_000, 10_001,
        19_999, 20_000, 123_456, 999_999, 1_000_000, 1_000_000_007, 987_654_327, 35_000_000_000,
        100_000_000_000, 85_005_359_056, u64::MAX / 10_000, u64::MAX / 50, u64::MAX / 2, u64::MAX - 1, u64::MAX,
    ];
    // A dense run around small multiples where the single ceiling and the two
    // floor caps interact.
    amounts.extend(1_990u64..2_010);
    amounts.extend(9_990u64..10_010);
    amounts.sort_unstable();
    amounts.dedup();
    println!(
        "{{\"provenance\":\"beam_program::beam_economics::allocate via the locked crate\",\"totalBps\":{TOTAL_FEE_BPS},\"communityBps\":{COMMUNITY_NOMINAL_BPS},\"treasuryBps\":{TREASURY_NOMINAL_BPS},\"founderBps\":{FOUNDER_NOMINAL_BPS},\"cases\":["
    );
    for (index, amount) in amounts.iter().enumerate() {
        let sep = if index == 0 { "" } else { "," };
        match allocate(*amount) {
            Ok(a) => println!(
                "{sep}{{\"quoteAmount\":\"{amount}\",\"total\":\"{}\",\"community\":\"{}\",\"treasury\":\"{}\",\"founder\":\"{}\"}}",
                a.total, a.community, a.treasury, a.founder
            ),
            Err(anchor_lang::error::Error::AnchorError(e)) => println!("{sep}{{\"quoteAmount\":\"{amount}\",\"error\":\"{}\"}}", e.error_name),
            Err(e) => println!("{sep}{{\"quoteAmount\":\"{amount}\",\"error\":\"{e:?}\"}}"),
        }
    }
    println!("]}}");
}

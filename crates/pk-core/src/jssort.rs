//! `Array.prototype.sort` — as a source of RNG DRAWS, not as a way to order
//! things.
//!
//! `maze/track-carve.ts growMazeAround` shuffles its four directions with
//!
//! ```js
//! const order = [...dirs].sort(() => rng() - 0.5);
//! ```
//!
//! which is the classic broken shuffle, and here that is not a bug to fix — it
//! is the oracle. Every comparator call SPENDS A DRAW, so the number of
//! comparisons V8 makes is part of the random stream. Measured on a 4-element
//! array, V8 makes **4 comparisons for eight of the outcomes and 5 for the other
//! sixteen**, so a port that used any other sort desynchronises the stream on
//! most calls and every draw after it is wrong. `growMazeAround` runs this
//! hundreds of times per floor.
//!
//! ## What V8 actually does, measured rather than recalled
//!
//! Small arrays go through a plain BINARY INSERTION SORT: for each `start` from
//! 1, binary-search `[0, start)` for the insertion point, then shift. No run
//! detection, no merging. The full comparison trace was captured from node for
//! every reachable outcome pattern and this implementation reproduces all
//! twenty-four of them, argument order included — see [`tests`].
//!
//! ⚠️ **THE MODEL BREAKS AT EIGHT.** Swept against node over every outcome
//! pattern: n = 2…7 match exactly, and n = 8 mismatches on every pattern
//! because TimSort's `CountAndMakeRun` takes over (an already-descending run of
//! 8 costs V8 seven comparisons where binary insertion costs seventeen). So
//! [`js_sort_by`] refuses lengths above [`MAX_VERIFIED_LEN`] rather than
//! quietly returning a plausible order with the wrong number of draws behind
//! it. Porting a longer JS sort means measuring TimSort first, not raising the
//! constant.
//!
//! PORTS: `maze/track-carve.ts`

/// The longest array this implementation has been verified against node for.
/// See the module header: eight is where TimSort's run detection takes over.
pub const MAX_VERIFIED_LEN: usize = 7;

/// V8's `Array.prototype.sort` for short arrays, comparator calls and all.
///
/// `cmp` is called exactly where and in the order V8 calls it, with the same
/// arguments in the same positions — `cmp(pivot, existing)`, never the reverse.
/// That matters for a comparator with side effects, which is the only kind this
/// function exists to serve.
///
/// The comparator returns a JS-style number: negative means "first argument
/// sorts earlier". Only the sign is read, and only `< 0` — exactly the test V8
/// makes, so a comparator returning `0` behaves as V8's "keep going right".
///
/// # Panics
/// If `a.len() > MAX_VERIFIED_LEN`. That is deliberate — see the module header.
pub fn js_sort_by<T: Copy>(a: &mut [T], mut cmp: impl FnMut(T, T) -> f64) {
    assert!(
        a.len() <= MAX_VERIFIED_LEN,
        "js_sort_by is verified against V8 only up to {MAX_VERIFIED_LEN} elements \
         (got {}); above that V8 switches to TimSort's run detection and makes a \
         DIFFERENT NUMBER of comparator calls — which, for a comparator that draws \
         from the rng, is a different floor",
        a.len()
    );
    for start in 1..a.len() {
        let mut left = 0;
        let mut right = start;
        let pivot = a[right];
        while left < right {
            // `left + ((right - left) >> 1)`, not `(left + right) / 2`. Same
            // value here, and it is what the source says.
            let mid = left + ((right - left) >> 1);
            if cmp(pivot, a[mid]) < 0.0 {
                right = mid;
            } else {
                left = mid + 1;
            }
        }
        let mut p = start;
        while p > left {
            a[p] = a[p - 1];
            p -= 1;
        }
        a[left] = pivot;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every reachable comparison trace of a 4-element sort, captured from node.
    ///
    /// This is the whole gate for [`js_sort_by`], and it is a trace rather than
    /// a result on purpose: two sorts can agree on the ORDER and disagree on how
    /// many times they asked, and it is the asking that spends the rng. Each
    /// entry is `(outcome bits, comparison trace, final order)`, where bit `k`
    /// is the sign the comparator returns on call `k` (0 = negative).
    ///
    /// Twenty-four traces, eight of length 4 and sixteen of length 5.
    const V8_TRACES: &[(&str, &str)] = &[
        ("BA+ CB+ DB+ DC+", "ABCD"),
        ("BA+ CB+ DB+ DC-", "ABDC"),
        ("BA+ CB+ DB- DA+", "ADBC"),
        ("BA+ CB+ DB- DA-", "DABC"),
        ("BA+ CB- CA+ DC+ DB+", "ACBD"),
        ("BA+ CB- CA+ DC+ DB-", "ACDB"),
        ("BA+ CB- CA+ DC- DA+", "ADCB"),
        ("BA+ CB- CA+ DC- DA-", "DACB"),
        ("BA+ CB- CA- DA+ DB+", "CABD"),
        ("BA+ CB- CA- DA+ DB-", "CADB"),
        ("BA+ CB- CA- DA- DC+", "CDAB"),
        ("BA+ CB- CA- DA- DC-", "DCAB"),
        ("BA- CA+ DA+ DC+", "BACD"),
        ("BA- CA+ DA+ DC-", "BADC"),
        ("BA- CA+ DA- DB+", "BDAC"),
        ("BA- CA+ DA- DB-", "DBAC"),
        ("BA- CA- CB+ DC+ DA+", "BCAD"),
        ("BA- CA- CB+ DC+ DA-", "BCDA"),
        ("BA- CA- CB+ DC- DB+", "BDCA"),
        ("BA- CA- CB+ DC- DB-", "DBCA"),
        ("BA- CA- CB- DB+ DA+", "CBAD"),
        ("BA- CA- CB- DB+ DA-", "CBDA"),
        ("BA- CA- CB- DB- DC+", "CDBA"),
        ("BA- CA- CB- DB- DC-", "DCBA"),
    ];

    #[test]
    fn reproduces_every_v8_trace_for_four_elements() {
        for (want_trace, want_order) in V8_TRACES {
            let signs: Vec<bool> = want_trace.split(' ').map(|t| t.ends_with('+')).collect();
            let mut a = [b'A', b'B', b'C', b'D'];
            let mut got_trace = Vec::new();
            let mut n = 0usize;
            js_sort_by(&mut a, |x, y| {
                let plus = signs.get(n).copied().unwrap_or(false);
                got_trace.push(format!(
                    "{}{}{}",
                    x as char,
                    y as char,
                    if plus { '+' } else { '-' }
                ));
                n += 1;
                if plus {
                    0.5
                } else {
                    -0.5
                }
            });
            assert_eq!(
                got_trace.join(" "),
                *want_trace,
                "the comparison SEQUENCE diverged — which pair, in which order, \
                 and how many times, is what spends the rng"
            );
            let order: String = a.iter().map(|&c| c as char).collect();
            assert_eq!(order, *want_order, "trace {want_trace} produced {order}");
        }
    }

    /// The refusal is the feature. A silent wrong answer above the verified
    /// length is exactly the failure this module exists to prevent.
    #[test]
    #[should_panic(expected = "verified against V8 only up to 7")]
    fn refuses_lengths_it_has_not_been_measured_at() {
        let mut a = [0u8; 8];
        js_sort_by(&mut a, |_, _| -0.5);
    }
}

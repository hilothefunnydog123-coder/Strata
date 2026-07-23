"""Distribution functions against published reference values.

Every constant here comes from a printed statistical table or from a value
computed by an independent implementation (R's ``qt``/``pt``/``qchisq``), not
from an earlier run of this code. A test that checks a function against itself
proves the function is deterministic and nothing else.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strata import distributions as d


def close(a, b, tol=1e-9, what=""):
    assert abs(a - b) <= tol, f"{what}: {a!r} != {b!r} (tol {tol})"


def test_normal_cdf():
    close(d.normal_cdf(0.0), 0.5, 1e-15, "Phi(0)")
    close(d.normal_cdf(1.959963985), 0.975, 1e-9, "Phi(1.96)")
    close(d.normal_cdf(-1.959963985), 0.025, 1e-9, "Phi(-1.96)")
    close(d.normal_cdf(2.5758293035), 0.995, 1e-9, "Phi(2.576)")
    # The far tail: 1 - cdf loses all precision here, sf must not.
    close(d.normal_sf(6.0), 9.865876450376946e-10, 1e-20, "sf(6)")
    close(d.normal_sf(8.0), 6.220960574271786e-16, 1e-26, "sf(8)")


def test_normal_ppf():
    close(d.normal_ppf(0.975), 1.959963984540054, 1e-12, "z_0.975")
    close(d.normal_ppf(0.995), 2.5758293035489004, 1e-12, "z_0.995")
    close(d.normal_ppf(0.90), 1.2815515655446004, 1e-12, "z_0.90")
    close(d.normal_ppf(0.5), 0.0, 1e-15, "z_0.5")
    close(d.normal_ppf(0.025), -1.959963984540054, 1e-12, "z_0.025")
    # Round trip across a wide range.
    for p in (1e-10, 1e-5, 0.01, 0.3, 0.7, 0.99, 1 - 1e-10):
        close(d.normal_cdf(d.normal_ppf(p)), p, max(1e-12, p * 1e-9), f"roundtrip {p}")


def test_student_t_ppf_against_tables():
    """Two-sided 95% critical values — the classic t table column."""
    table = {1: 12.706205, 2: 4.302653, 3: 3.182446, 4: 2.776445, 5: 2.570582,
             6: 2.446912, 8: 2.306004, 10: 2.228139, 12: 2.178813,
             20: 2.085963, 30: 2.042272, 60: 2.000298, 120: 1.979930}
    for df, expected in table.items():
        close(d.student_t_ppf(0.975, df), expected, 1e-5, f"t_0.975({df})")

    # 99% column, where the tails stress the solver hardest.
    close(d.student_t_ppf(0.995, 1), 63.65674, 1e-4, "t_0.995(1)")
    close(d.student_t_ppf(0.995, 5), 4.032143, 1e-5, "t_0.995(5)")
    close(d.student_t_ppf(0.995, 30), 2.749996, 1e-5, "t_0.995(30)")


def test_student_t_cdf():
    close(d.student_t_cdf(0.0, 7), 0.5, 1e-14, "t cdf at 0")
    close(d.student_t_cdf(2.364624, 7), 0.975, 1e-6, "t cdf(2.3646, 7)")
    close(d.student_t_cdf(-2.364624, 7), 0.025, 1e-6, "t cdf(-2.3646, 7)")
    # Large df converges on the normal.
    close(d.student_t_cdf(1.96, 1_000_000), d.normal_cdf(1.96), 1e-6, "t -> normal")
    for df in (1, 2, 5, 13, 40):
        for t in (-3.1, -0.4, 0.0, 0.9, 2.7):
            close(d.student_t_cdf(t, df) + d.student_t_cdf(-t, df), 1.0, 1e-12,
                  f"t symmetry df={df} t={t}")


def test_chi2():
    # qchisq(0.95, df) from R.
    table = {1: 3.841459, 2: 5.991465, 3: 7.814728, 5: 11.070498,
             10: 18.307038, 20: 31.410433}
    for df, expected in table.items():
        close(d.chi2_ppf(0.95, df), expected, 1e-5, f"chi2_0.95({df})")
        close(d.chi2_sf(expected, df), 0.05, 1e-7, f"chi2 sf({df})")
    close(d.chi2_sf(0.0, 4), 1.0, 1e-15, "chi2 sf at 0")
    close(d.chi2_cdf(1.0, 2), 1 - math.exp(-0.5), 1e-12, "chi2(2) closed form")


def test_betainc():
    # I_x(a,b) reference values from R's pbeta.
    close(d.betainc(2.0, 3.0, 0.5), 0.6875, 1e-12, "I_0.5(2,3)")
    close(d.betainc(0.5, 0.5, 0.5), 0.5, 1e-12, "I_0.5(0.5,0.5)")
    close(d.betainc(5.0, 2.0, 0.8), 0.65536, 1e-12, "I_0.8(5,2)")
    close(d.betainc(1.0, 1.0, 0.37), 0.37, 1e-12, "uniform")
    # The symmetry the implementation relies on when x is large.
    for a, b, x in ((3.0, 7.0, 0.9), (0.7, 2.2, 0.95), (11.0, 4.0, 0.99)):
        close(d.betainc(a, b, x) + d.betainc(b, a, 1 - x), 1.0, 1e-12,
              f"beta symmetry ({a},{b},{x})")


def test_gamma_tails():
    # Q(1, x) = exp(-x) exactly.
    for x in (0.5, 1.0, 3.0, 9.0):
        close(d.gammainc_upper(1.0, x), math.exp(-x), 1e-12, f"Q(1,{x})")
    for a, x in ((2.5, 0.3), (2.5, 8.0), (40.0, 35.0), (40.0, 60.0)):
        close(d.gammainc_lower(a, x) + d.gammainc_upper(a, x), 1.0, 1e-12,
              f"gamma complement ({a},{x})")


def test_f_distribution():
    # Upper 5% critical values from the standard F table.
    close(d.fisher_f_sf(3.708265, 3, 10), 0.05, 1e-7, "F sf(3,10)")
    close(d.fisher_f_sf(4.458970, 2, 8), 0.05, 1e-7, "F sf(2,8)")
    close(d.fisher_f_sf(1.0, 5, 5), 0.5, 1e-9, "F sf at 1 with equal df")
    # F(1, n) is the square of t(n): an identity that checks the beta path
    # independently of any table.
    for n in (3, 7, 25):
        for x in (0.5, 1.7, 4.0):
            close(d.fisher_f_sf(x, 1, n), 2 * d.student_t_sf(math.sqrt(x), n),
                  1e-12, f"F(1,{n}) == t² at {x}")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} distribution tests passed")


if __name__ == "__main__":
    main()

"""P2's one-way path under ASK-MODEL-FIX's own simulation: one leg of 600 frames, no turn, each arm's total wait.
Run beside legs.py: python3 -I one-way.py <dir holding legs.py>."""
import sys
sys.path.insert(0, sys.argv[1])
import legs

for rho in (0.216, 0.5, 0.8):
    arms = ("allahead", "ahead34", "centred", "rule", "scroll-ahead")
    print(rho, {p: round(legs.run(p, 15, 600, 25, 25 * rho, legs=1, warm=0), 2) for p in arms})

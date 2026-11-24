for r in 1 2; do
 for c in orig B1 A; do for v in page worker; do for k in 418 419 merged; do
  bash /tmp/claude-0/s/run.sh $k $c dbts_a1-q8-g8-cut $v r$r
 done; done; done
 for k in merged merged-nowait; do bash /tmp/claude-0/s/run.sh $k orig dbts_a1-q8-g16-cut worker r$r; done
done
bash /tmp/claude-0/s/run.sh merged orig dbts_a1-q8-g16-cut worker r3
bash /tmp/claude-0/s/run.sh merged-nowait orig dbts_a1-q8-g16-cut worker r3
echo PLAN-DONE >> /tmp/claude-0/s/plan.log

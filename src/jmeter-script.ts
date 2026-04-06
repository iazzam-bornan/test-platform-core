export interface JmeterScriptOptions {
  testPlanPath: string
  threads: number
  rampUp: number
  loops: number
  duration?: number
  errorThreshold: number
  properties: Record<string, string>
}

/**
 * Generates a shell script that:
 * 1. Counts samplers in the .jmx file and emits a "plan" @@RESULT@@ event
 * 2. Starts a background tail loop that polls the JMeter CSV and emits one
 *    @@RESULT@@ line per sample as it appears (live streaming)
 * 3. Runs JMeter (with autoflush enabled so the CSV is written line-by-line)
 * 4. Signals the tail loop to drain remaining rows and exit
 * 5. Computes the final summary @@RESULT@@ from the full CSV
 * 6. Exits 0/1 based on the error threshold
 */
export function generateJmeterScript(opts: JmeterScriptOptions): string {
  const jmeterArgs: string[] = [
    "-n",
    `-t ${opts.testPlanPath}`,
    '-l "$RESULTS_DIR/results.csv"',
    '-j "$RESULTS_DIR/jmeter.log"',
    // Force JMeter to flush the CSV writer per sample so live tailing works
    "-Jjmeter.save.saveservice.autoflush=true",
    `-JTHREADS=${opts.threads}`,
    `-JRAMP_UP=${opts.rampUp}`,
    `-JLOOPS=${opts.loops}`,
  ]

  if (opts.duration) {
    jmeterArgs.push(`-JDURATION=${opts.duration}`)
  }

  for (const [k, v] of Object.entries(opts.properties)) {
    jmeterArgs.push(`-J${k}=${v}`)
  }

  const jmeterCmd = `jmeter ${jmeterArgs.join(" ")}`

  return `#!/bin/sh
set -e

RESULTS_DIR="/results"
mkdir -p "$RESULTS_DIR"

THREADS=${opts.threads}
RAMP_UP=${opts.rampUp}
LOOPS=${opts.loops}
ERROR_THRESHOLD=${opts.errorThreshold}
TEST_PLAN=${opts.testPlanPath}
SENTINEL=/tmp/jmeter-done

rm -f "$SENTINEL" "$RESULTS_DIR/results.csv"

echo "=== JMeter Load Test ==="
echo "Threads: $THREADS, Ramp-up: ${'$'}{RAMP_UP}s, Loops: $LOOPS"
echo "Error threshold: ${'$'}{ERROR_THRESHOLD}%"
echo "========================"

# Count HTTPSamplerProxy entries to compute the planned total
NUM_SAMPLERS=$(grep -c '<HTTPSamplerProxy ' "$TEST_PLAN" 2>/dev/null | tr -d ' ' || echo 0)
${opts.duration ? '# Duration-based test: planned total is unknown' : 'PLANNED=$((THREADS * LOOPS * NUM_SAMPLERS))'}
${opts.duration ? '' : `if [ "$PLANNED" -gt 0 ]; then
  printf '@@RESULT@@{"type":"plan","totalChecks":%d}\\n' "$PLANNED" >&2
fi`}

# ---------------------------------------------------------------------------
# Background tail loop: polls the CSV file for new rows and emits @@RESULT@@
# lines as JMeter writes them. Exits when the sentinel file appears.
# ---------------------------------------------------------------------------
emit_csv_results() {
  LAST_LINE=1  # CSV has a header row, real samples start at line 2
  while true; do
    if [ -f "$RESULTS_DIR/results.csv" ]; then
      TOTAL=$(wc -l < "$RESULTS_DIR/results.csv" 2>/dev/null | tr -d ' ')
      if [ -n "$TOTAL" ] && [ "$TOTAL" -gt "$LAST_LINE" ]; then
        sed -n "$((LAST_LINE + 1)),${'$'}{TOTAL}p" "$RESULTS_DIR/results.csv" 2>/dev/null | while IFS=',' read -r ts elapsed label rcode rmsg tname success fmsg bytesVal sentBytesVal grp allT urlVal latencyVal idleVal connectVal rest; do
          [ -z "$elapsed" ] && continue
          if [ "$success" = "true" ]; then okVal="true"; else okVal="false"; fi
          label_e=$(printf '%s' "$label" | sed 's/"/\\\\"/g')
          rmsg_e=$(printf '%s' "$rmsg" | sed 's/"/\\\\"/g')
          tname_e=$(printf '%s' "$tname" | sed 's/"/\\\\"/g')
          url_e=$(printf '%s' "$urlVal" | sed 's/"/\\\\"/g')
          printf '@@RESULT@@{"label":"%s","url":"%s","status":"%s","ok":%s,"duration":%s,"latency":%s,"connectTime":%s,"bytes":%s,"sentBytes":%s,"threadName":"%s","responseCode":"%s","responseMessage":"%s","timestamp":"%s"}\\n' "$label_e" "$url_e" "$rcode" "$okVal" "$elapsed" "${'$'}{latencyVal:-0}" "${'$'}{connectVal:-0}" "${'$'}{bytesVal:-0}" "${'$'}{sentBytesVal:-0}" "$tname_e" "$rcode" "$rmsg_e" "$ts" >&2
        done
        LAST_LINE=$TOTAL
      fi
    fi
    if [ -f "$SENTINEL" ]; then
      # Final drain pass
      if [ -f "$RESULTS_DIR/results.csv" ]; then
        TOTAL=$(wc -l < "$RESULTS_DIR/results.csv" 2>/dev/null | tr -d ' ')
        if [ -n "$TOTAL" ] && [ "$TOTAL" -gt "$LAST_LINE" ]; then
          sed -n "$((LAST_LINE + 1)),${'$'}{TOTAL}p" "$RESULTS_DIR/results.csv" 2>/dev/null | while IFS=',' read -r ts elapsed label rcode rmsg tname success fmsg bytesVal sentBytesVal grp allT urlVal latencyVal idleVal connectVal rest; do
            [ -z "$elapsed" ] && continue
            if [ "$success" = "true" ]; then okVal="true"; else okVal="false"; fi
            label_e=$(printf '%s' "$label" | sed 's/"/\\\\"/g')
            rmsg_e=$(printf '%s' "$rmsg" | sed 's/"/\\\\"/g')
            tname_e=$(printf '%s' "$tname" | sed 's/"/\\\\"/g')
            url_e=$(printf '%s' "$urlVal" | sed 's/"/\\\\"/g')
            printf '@@RESULT@@{"label":"%s","url":"%s","status":"%s","ok":%s,"duration":%s,"latency":%s,"connectTime":%s,"bytes":%s,"sentBytes":%s,"threadName":"%s","responseCode":"%s","responseMessage":"%s","timestamp":"%s"}\\n' "$label_e" "$url_e" "$rcode" "$okVal" "$elapsed" "${'$'}{latencyVal:-0}" "${'$'}{connectVal:-0}" "${'$'}{bytesVal:-0}" "${'$'}{sentBytesVal:-0}" "$tname_e" "$rcode" "$rmsg_e" "$ts" >&2
          done
        fi
      fi
      exit 0
    fi
    sleep 0.5
  done
}

emit_csv_results &
TAIL_PID=$!

# Run JMeter in the foreground
set +e
${jmeterCmd}
EXIT_CODE=$?
set -e

# Tell the tail loop to drain and exit
touch "$SENTINEL"
wait $TAIL_PID 2>/dev/null || true

echo ""
echo "JMeter execution complete. Computing final summary..."

if [ ! -f "$RESULTS_DIR/results.csv" ]; then
  echo "ERROR: No results file generated" >&2
  exit 1
fi

TOTAL=$(tail -n +2 "$RESULTS_DIR/results.csv" | wc -l | tr -d ' ')

if [ "$TOTAL" -eq 0 ] 2>/dev/null; then
  echo "ERROR: No test results found"
  exit 1
fi

FAILURES=$(tail -n +2 "$RESULTS_DIR/results.csv" | awk -F',' '{print $7}' | grep -c "false" || true)
PASSED=$((TOTAL - FAILURES))
ERROR_RATE=$((FAILURES * 100 / TOTAL))
PASS_RATE=$((PASSED * 100 / TOTAL))

# Aggregate timing stats
STATS=$(tail -n +2 "$RESULTS_DIR/results.csv" | awk -F',' '
BEGIN { min=999999999; max=0; sum=0; count=0 }
{
  v=$2+0
  sum+=v; count++
  if(v<min) min=v
  if(v>max) max=v
  times[count]=v
}
END {
  if(count==0) { print "0 0 0 0 0"; exit }
  avg=int(sum/count)
  n=count
  for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) if(times[i]>times[j]){t=times[i];times[i]=times[j];times[j]=t}
  p90idx=int(n*0.9); if(p90idx<1) p90idx=1
  p95idx=int(n*0.95); if(p95idx<1) p95idx=1
  printf "%d %d %d %d %d", avg, min, max, times[p90idx], times[p95idx]
}')

AVG=$(echo "$STATS" | awk '{print $1}')
MIN_VAL=$(echo "$STATS" | awk '{print $2}')
MAX_VAL=$(echo "$STATS" | awk '{print $3}')
P90=$(echo "$STATS" | awk '{print $4}')
P95=$(echo "$STATS" | awk '{print $5}')

printf '@@RESULT@@{"type":"summary","totalChecks":%d,"passed":%d,"failed":%d,"passRate":%d,"errorRate":%d,"avgDuration":%d,"minDuration":%d,"maxDuration":%d,"p90Duration":%d,"p95Duration":%d}\\n' "$TOTAL" "$PASSED" "$FAILURES" "$PASS_RATE" "$ERROR_RATE" "$AVG" "$MIN_VAL" "$MAX_VAL" "$P90" "$P95" >&2

echo ""
echo "=== Results ==="
echo "Total requests: $TOTAL"
echo "Failures: $FAILURES"
echo "Error rate: ${'$'}{ERROR_RATE}%"
echo "Threshold: ${opts.errorThreshold}%"

if [ "$ERROR_RATE" -gt "${opts.errorThreshold}" ]; then
  echo "FAILED: Error rate ${'$'}{ERROR_RATE}% exceeds threshold ${opts.errorThreshold}%"
  exit 1
else
  echo "PASSED: Error rate ${'$'}{ERROR_RATE}% within threshold ${opts.errorThreshold}%"
  exit 0
fi
`
}

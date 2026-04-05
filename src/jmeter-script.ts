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
 * 1. Runs JMeter in non-GUI mode with the provided test plan
 * 2. Parses the CSV results
 * 3. Emits @@RESULT@@ JSON lines to stderr (same protocol as HTTP checks)
 * 4. Exits 0/1 based on error threshold
 */
export function generateJmeterScript(opts: JmeterScriptOptions): string {
  const jProps = Object.entries(opts.properties)
    .map(([k, v]) => `-J${k}=${v}`)
    .join(" \\\n  ")

  const threadsProp = `-JTHREADS=${opts.threads}`
  const rampProp = `-JRAMP_UP=${opts.rampUp}`
  const loopsProp = `-JLOOPS=${opts.loops}`
  const durationFlag = opts.duration ? `-JDURATION=${opts.duration}` : ""

  return `#!/bin/sh
set -e

RESULTS_DIR="/results"
mkdir -p "$RESULTS_DIR"

echo "=== JMeter Load Test ==="
echo "Threads: ${opts.threads}, Ramp-up: ${opts.rampUp}s, Loops: ${opts.loops}"
echo "Error threshold: ${opts.errorThreshold}%"
echo "========================"

jmeter -n \\
  -t ${opts.testPlanPath} \\
  -l "$RESULTS_DIR/results.csv" \\
  -j "$RESULTS_DIR/jmeter.log" \\
  ${threadsProp} \\
  ${rampProp} \\
  ${loopsProp} \\
  ${durationFlag ? durationFlag + " \\\\" : "\\\\"}
  ${jProps ? jProps : ""}

echo ""
echo "JMeter execution complete. Parsing results..."

# Check results file exists
if [ ! -f "$RESULTS_DIR/results.csv" ]; then
  echo "ERROR: No results file generated" >&2
  exit 1
fi

TOTAL=$(tail -n +2 "$RESULTS_DIR/results.csv" | wc -l | tr -d ' ')

if [ "$TOTAL" -eq 0 ] 2>/dev/null; then
  echo "ERROR: No test results found"
  exit 1
fi

# Emit individual @@RESULT@@ lines from CSV
# CSV columns: timeStamp,elapsed,label,responseCode,responseMessage,threadName,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,URL,Latency,IdleTime,Connect
tail -n +2 "$RESULTS_DIR/results.csv" | while IFS=',' read -r ts elapsed label rcode rmsg tname success fmsg bytesVal sentBytesVal grp allT urlVal latencyVal idleVal connectVal rest; do
  if [ "$success" = "true" ]; then
    okVal="true"
  else
    okVal="false"
  fi
  # Clean up values
  label=$(echo "$label" | sed 's/"/\\\\"/g')
  rmsg=$(echo "$rmsg" | sed 's/"/\\\\"/g')
  tname=$(echo "$tname" | sed 's/"/\\\\"/g')
  urlVal=$(echo "$urlVal" | sed 's/"/\\\\"/g')
  printf '@@RESULT@@{"label":"%s","url":"%s","status":%s,"ok":%s,"duration":%s,"latency":%s,"connectTime":%s,"bytes":%s,"sentBytes":%s,"threadName":"%s","responseCode":"%s","responseMessage":"%s","timestamp":"%s"}\\n' \\
    "$label" "$urlVal" "$elapsed" "$okVal" "$elapsed" "\${latencyVal:-0}" "\${connectVal:-0}" "\${bytesVal:-0}" "\${sentBytesVal:-0}" "$tname" "$rcode" "$rmsg" "$ts" >&2
done

# Calculate statistics
FAILURES=$(tail -n +2 "$RESULTS_DIR/results.csv" | awk -F',' '{print $7}' | grep -c "false" || true)
PASSED=$((TOTAL - FAILURES))
ERROR_RATE=$((FAILURES * 100 / TOTAL))
PASS_RATE=$((PASSED * 100 / TOTAL))

# Calculate timing stats
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
  if(count==0) { print "0 0 0 0 0 0"; exit }
  avg=int(sum/count)
  # Sort for percentiles
  n=count
  for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) if(times[i]>times[j]){t=times[i];times[i]=times[j];times[j]=t}
  p90idx=int(n*0.9); if(p90idx<1) p90idx=1
  p95idx=int(n*0.95); if(p95idx<1) p95idx=1
  p90=times[p90idx]
  p95=times[p95idx]
  # Throughput: first and last timestamp
  printf "%d %d %d %d %d", avg, min, max, p90, p95
}')

AVG=$(echo "$STATS" | awk '{print $1}')
MIN=$(echo "$STATS" | awk '{print $2}')
MAX=$(echo "$STATS" | awk '{print $3}')
P90=$(echo "$STATS" | awk '{print $4}')
P95=$(echo "$STATS" | awk '{print $5}')

# Emit summary
printf '@@RESULT@@{"type":"summary","totalChecks":%d,"passed":%d,"failed":%d,"passRate":%d,"errorRate":%d,"avgDuration":%d,"minDuration":%d,"maxDuration":%d,"p90Duration":%d,"p95Duration":%d}\\n' \\
  "$TOTAL" "$PASSED" "$FAILURES" "$PASS_RATE" "$ERROR_RATE" "$AVG" "$MIN" "$MAX" "$P90" "$P95" >&2

echo ""
echo "=== Results ==="
echo "Total requests: $TOTAL"
echo "Failures: $FAILURES"
echo "Error rate: \${ERROR_RATE}%"
echo "Threshold: ${opts.errorThreshold}%"

if [ "$ERROR_RATE" -gt "${opts.errorThreshold}" ]; then
  echo "FAILED: Error rate \${ERROR_RATE}% exceeds threshold ${opts.errorThreshold}%"
  exit 1
else
  echo "PASSED: Error rate \${ERROR_RATE}% within threshold ${opts.errorThreshold}%"
  exit 0
fi
`
}

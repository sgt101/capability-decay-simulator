cd /workspace/capability-decay-simulator
RHO=1,2,3,4,5,6,7,8,16,32,64,66,128,187,256,263,512,735,1024,2048

for n in $(seq 1 15); do
  # skip ones already done with the union list, so an interrupt is resumable
  if grep -q '"rhos"' results/rho/acl.$n/rho_summary.json 2>/dev/null \
     && grep -q '^\s*735,\?$' results/rho/acl.$n/rho_summary.json; then
    echo "=== acl.$n already has the union list, skipping ==="
    continue
  fi
  node src/rho_sensitivity.js --config data/experiments-acl/acl.$n.json \
    --rho "$RHO" --stride 1 --replicates 32 --workers 16
done

node src/rho_sensitivity.js --index

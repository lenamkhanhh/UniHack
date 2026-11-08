import subprocess
import os

contracts_dir = os.path.abspath('UniHack/contracts')
evidence_dir = os.path.abspath('UniHack/evidence/security')
os.makedirs(evidence_dir, exist_ok=True)
out_file = os.path.join(evidence_dir, 'slither.txt')

cmd = ['python', '-m', 'slither', '.', '--filter-paths', 'lib/|test/|contracts/test/']
print(f"Running: {' '.join(cmd)} in {contracts_dir}")

res = subprocess.run(cmd, cwd=contracts_dir, capture_output=True, text=True, encoding='utf-8', errors='replace')

output = f"Slither Analyzer v0.11.6\nCommand: {' '.join(cmd)}\nExit Code: {res.returncode}\n\nSTDOUT:\n{res.stdout}\n\nSTDERR:\n{res.stderr}"

with open(out_file, 'w', encoding='utf-8') as f:
    f.write(output)

print(f"Slither output written to {out_file} ({len(output)} chars)")
print("Preview:\n" + output[:1000])

/**
 * Read-only content/optional Git history scanner. NEVER prints secret values or matching lines.
 * Use: node scripts/sanitize_check.mjs [--history]
 * It is a heuristic scanner, NOT proof that no secret has ever been published.
 */
import {readdirSync,readFileSync,statSync,existsSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const excluded=new Set(['.git','node_modules','data','test-results','PREMIUM-PREVIEWS','REPAIR-FIRST-PREVIEWS','.venv']);
const pats=[
 ['exposed_recovery_url',/(?:#recover=|\brecover=)[A-Za-z0-9_-]{32,}/gi],
 ['embedded_private_link',/#[A-Z]{3}-\d{6}-[A-F0-9]{8,16}:[A-Za-z0-9_-]{32,}/gi],
 ['provider_secret',/\b(?:rzp_(?:live|test)_[A-Za-z0-9]{12,}|sk_(?:live|test)_[A-Za-z0-9]{12,})\b/g],
 ['credential_assignment',/\b(?:ADMIN_PASSWORD|RAZORPAY_KEY_SECRET|TWILIO_AUTH_TOKEN|RL_RESEND_KEY)\s*[:=]\s*['"](?!(?:\$|<|REPLACE|change|example|your|test|mock))[^'"\s]{8,}['"]/gi],
];
const findings=[];let scanned=0;
function scan(text,name){for(const [category,re] of pats){re.lastIndex=0;let m;while((m=re.exec(text))!==null){const line=text.slice(0,m.index).split('\n').length;findings.push({file:name,line,category});}}}
function walk(dir){for(const name of readdirSync(dir)){if(excluded.has(name))continue;const file=join(dir,name),rel=relative(root,file);const st=statSync(file);if(st.isDirectory()){walk(file);continue;}if(st.size>2_000_000||!/(?:\.m?js|\.py|\.md|\.txt|\.json|\.html|\.css|\.yml|\.yaml|\.ps1|\.cmd|\.vbs|\.example)$/.test(name))continue;scanned++;scan(readFileSync(file,'utf8'),rel);}}
walk(root);
let history={status:'NOT_REQUESTED',commits_scanned:0};
if(process.argv.includes('--history')){
 if(!existsSync(join(root,'.git'))){history={status:'BLOCKED_NO_GIT_HISTORY_IN_ARCHIVE',commits_scanned:0};}
 else{
  const result=spawnSync('git',['rev-list','--all'],{cwd:root,encoding:'utf8',maxBuffer:10_000_000});
  if(result.status!==0){history={status:'BLOCKED_GIT_ERROR',commits_scanned:0};}
  else{
   const ids=result.stdout.trim().split('\n').filter(Boolean).slice(0,500);
   for(const id of ids){const files=spawnSync('git',['ls-tree','-r','--name-only',id],{cwd:root,encoding:'utf8',maxBuffer:20_000_000});if(files.status!==0)continue;
    for(const path of files.stdout.split('\n')){if(!path||/(^|\/)(?:node_modules|data|\.git)\//.test(path))continue;
      if(!/\.(?:md|mjs|js|py|txt|json|html|env|yml)$/.test(path))continue;
      const blob=spawnSync('git',['show',`${id}:${path}`],{cwd:root,encoding:'utf8',maxBuffer:2_000_000});if(blob.status===0)scan(blob.stdout,`commit:${id.slice(0,12)}:${path}`);
    }
   }
   history={status:ids.length>=500?'PARTIAL_HISTORY_FIRST_500_COMMITS':'SCANNED',commits_scanned:ids.length};
  }
 }
}
const unique=[...new Map(findings.map(x=>[`${x.file}:${x.line}:${x.category}`,x])).values()];
console.log(JSON.stringify({status:unique.length?'REVIEW_REQUIRED':'NO_MATCHES_FOR_CONFIGURED_PATTERNS',files_scanned:scanned,findings:unique,history,notes:['Matching secret text is NEVER printed.','This heuristic scan does not certify that the repository or remote Git history is clean.','If a secret was published, revoke it with its provider; Git history cleanup alone is insufficient.']},null,2));
if(unique.length)process.exitCode=1;

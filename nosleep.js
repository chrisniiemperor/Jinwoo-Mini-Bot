const http = require('http');
const os = require('os');
const path = require('path');
const config = require('./config');
const { loadCommands } = require('./utils/commandLoader');
const stats = require('./utils/dashboardStats');
const PORT = Number(process.env.PORT || 3000);
let whatsappStatus = 'starting';
let lastStatusChange = new Date().toISOString();
function setWhatsAppStatus(status) { whatsappStatus = status; lastStatusChange = new Date().toISOString(); }
function json(res, code, data) { const body=JSON.stringify(data); res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}); res.end(body); }
function authorized(req) { const key=req.headers['x-api-key'] || (req.headers.authorization||'').replace(/^Bearer\s+/i,''); const expected=stats.getApiKey(); return Boolean(expected && key && key===expected); }
function duration(sec){ sec=Math.max(0,Math.floor(sec)); const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60),s=sec%60; return `${d?d+'d ':''}${h? h+'h ':''}${m?m+'m ':''}${s}s`.trim(); }
function commandList(){ const m=loadCommands(); const seen=new Set(); const out=[]; for(const [name,c] of m){ if(seen.has(c)) continue; seen.add(c); out.push({name:c.name, aliases:c.aliases||[], category:c.category||'general', description:c.description||'', ownerOnly:!!c.ownerOnly, adminOnly:!!c.adminOnly, groupOnly:!!c.groupOnly, privateOnly:!!c.privateOnly}); } return out.sort((a,b)=>a.name.localeCompare(b.name)); }
const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/', `http://${req.headers.host||'localhost'}`);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-API-Key,Authorization','Access-Control-Allow-Methods':'GET,OPTIONS'});return res.end();}
  if(u.pathname==='/'||u.pathname==='/health'){return json(res,200,{status:'ok',service:'Jinwoo Mini-Bot',whatsapp:whatsappStatus,uptime:Math.floor(process.uptime()),uptimeText:duration(process.uptime()),lastStatusChange,timestamp:new Date().toISOString(),version:process.env.npm_package_version||'1.0.0'});}
  if(!u.pathname.startsWith('/api/dashboard/')) return json(res,404,{status:'not_found'});
  if(!authorized(req)) return json(res,401,{message:'Unauthorized'});
  const s=stats.getStats();
  if(u.pathname==='/api/dashboard/summary') return json(res,200,{status:whatsappStatus,botName:config.botName,number:global.__JINWOO_BOT_NUMBER||null,prefix:config.prefix,uptime:Math.floor(process.uptime()),uptimeText:duration(process.uptime()),messages:s.messages,commands:s.commands,users:Object.keys(s.users).length,groups:Object.keys(s.groups).length,aiRequests:s.aiRequests,downloads:s.downloads,lastStatusChange});
  if(u.pathname==='/api/dashboard/status') return json(res,200,{status:whatsappStatus,botName:config.botName,number:global.__JINWOO_BOT_NUMBER||null,node:process.version,platform:process.platform,arch:process.arch,uptime:Math.floor(process.uptime()),uptimeText:duration(process.uptime()),memory:{rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed,heapTotal:process.memoryUsage().heapTotal},cpuLoad:os.loadavg(),pid:process.pid,lastStatusChange});
  if(u.pathname==='/api/dashboard/analytics') return json(res,200,{messages:s.messages,commands:s.commands,users:Object.keys(s.users).length,groups:Object.keys(s.groups).length,aiRequests:s.aiRequests,downloads:s.downloads,commandUsage:s.commandUsage,recent:s.recent});
  if(u.pathname==='/api/dashboard/commands') return json(res,200,{total:commandList().length,commands:commandList(),usage:s.commandUsage});
  if(u.pathname==='/api/dashboard/users') return json(res,200,{total:Object.keys(s.users).length,users:Object.values(s.users).sort((a,b)=>String(b.lastSeen).localeCompare(String(a.lastSeen)))});
  if(u.pathname==='/api/dashboard/groups') return json(res,200,{total:Object.keys(s.groups).length,groups:Object.values(s.groups).sort((a,b)=>(b.messages||0)-(a.messages||0))});
  if(u.pathname==='/api/dashboard/storage') { let st; try{st=require('fs').statSync(stats.STATS_FILE)}catch{} return json(res,200,{statsFile:stats.STATS_FILE,exists:!!st,size:st?.size||0,sessionName:config.sessionName,dataDirectory:path.dirname(stats.STATS_FILE)}); }
  if(u.pathname==='/api/dashboard/security') return json(res,200,{apiProtected:true,apiKeyConfigured:Boolean(stats.getApiKey()),dashboardApi:'protected',ownerNumbers:config.ownerNumber?.length||0,selfMode:!!config.selfMode});
  if(u.pathname==='/api/dashboard/settings') return json(res,200,{botName:config.botName,prefix:config.prefix,timezone:config.timezone,sessionName:config.sessionName,selfMode:config.selfMode,autoRead:config.autoRead,autoTyping:config.autoTyping,autoBio:config.autoBio,autoReact:config.autoReact,autoDownload:config.autoDownload,defaultGroupSettings:config.defaultGroupSettings});
  return json(res,404,{message:'Dashboard endpoint not found'});
});
server.on('error',e=>console.error('❌ API server error:',e.message));
server.listen(PORT,'0.0.0.0',()=>console.log(`🌐 Jinwoo API listening on 0.0.0.0:${PORT}`));
module.exports={server,setWhatsAppStatus};

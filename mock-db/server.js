const http = require('http');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(__dirname + '/data.json'));
const server = http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');const m=req.url.match(/^\/api\/([^/?]+)/);if(!m){res.writeHead(404);return res.end(JSON.stringify({error:'not_found'}));}const value=data[m[1]];if(!value){res.writeHead(404);return res.end(JSON.stringify({error:'collection_not_found'}));}res.end(JSON.stringify(value));});
server.listen(process.env.PORT||8787,()=>console.log('Mock DB em http://localhost:'+(process.env.PORT||8787)));

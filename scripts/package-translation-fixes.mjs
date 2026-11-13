// Patch only the verified translation-reader/name-matching functions into an
// existing app archive. A full workspace rebuild currently lacks the installed API UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import esbuild from '../node_modules/.pnpm/node_modules/esbuild/lib/main.js';
const require=createRequire(import.meta.url);
const asar=require('../node_modules/.pnpm/node_modules/@electron/asar/lib/asar.js');
const parser=require('../node_modules/.pnpm/node_modules/@babel/parser');
const traverse=require('../node_modules/.pnpm/node_modules/@babel/traverse').default;
const root=path.resolve(process.argv[2]||'scratch/fix12-20261110');
const baseline=path.join(root,'baseline.asar'),stage=path.join(root,'app'),mainKey=['out','main','index.js'].join(path.sep);
const expected=JSON.parse(await fs.readFile(path.join(root,'baseline.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
if(hash(await fs.readFile(baseline))!==expected.archiveHash)throw Error('Baseline archive checksum mismatch');
await fs.mkdir(stage,{recursive:true});asar.extractAll(baseline,stage);
const entry=path.join(root,'patch-entry.ts');
await fs.writeFile(entry,"export {lockNamesInSource,normalizeChineseNameForMatching} from '../../src/core/nameLocker';\nexport {scanMatchingEntities} from '../../src/core/storyMemory';\nexport {compileStoryBiblePrompt} from '../../src/core/promptCompilerV2';\nexport {readGeminiTextResponse} from '../../src/main/gemini/geminiResponse';\n");
const builtFile=path.join(root,'patch-functions.mjs');
await esbuild.build({entryPoints:[entry],outfile:builtFile,bundle:true,platform:'node',format:'esm',target:'node22',packages:'external'});
const original=asar.extractFile(baseline,mainKey).toString('utf8');let built=await fs.readFile(builtFile,'utf8');
const parse=s=>parser.parse(s,{sourceType:'module'});const oldTree=parse(original);
const fn=(tree,name)=>{const nodes=tree.program.body.filter(n=>n.type==='FunctionDeclaration'&&n.id?.name===name);if(nodes.length!==1)throw Error('Expected one function '+name);return nodes[0];};
// The installed bundle names chinese-conv's functions p/r. Resolve those names
// from the existing locker instead of introducing an unbound sify/tify import.
const converterNames={};traverse(oldTree,{VariableDeclarator(p){if(p.node.start<fn(oldTree,'lockNamesInSource').start||p.node.end>fn(oldTree,'lockNamesInSource').end)return;if(['sKey','tKey'].includes(p.node.id?.name)&&p.node.init?.type==='CallExpression')converterNames[p.node.id.name==='sKey'?'sify':'tify']=p.node.init.callee.name;}});
if(!converterNames.sify||!converterNames.tify)throw Error('Cannot resolve installed Chinese converters');
const aliasEdits=[];traverse(parse(built),{ReferencedIdentifier(p){const binding=p.scope.getBinding(p.node.name);const imported=binding?.path.node;if(imported?.type==='ImportSpecifier'&&converterNames[imported.imported?.name])aliasEdits.push({start:p.node.start,end:p.node.end,text:converterNames[imported.imported.name]});}});
for(const edit of aliasEdits.sort((a,b)=>b.start-a.start))built=built.slice(0,edit.start)+edit.text+built.slice(edit.end);
const newTree=parse(built);
const variable=(node,name)=>{const nodes=node.body.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).filter(n=>n.id?.name===name);if(nodes.length!==1)throw Error('Expected one local '+name);return nodes[0];};
const changes=[];const add=(start,end,text,label)=>changes.push({start,end,text,label});
for(const name of ['lockNamesInSource','scanMatchingEntities']){const a=fn(oldTree,name),b=fn(newTree,name);add(a.start,a.end,built.slice(b.start,b.end),name);}
const oldCompiler=fn(oldTree,'compileStoryBiblePrompt'),newCompiler=fn(newTree,'compileStoryBiblePrompt');
for(const name of ['presentEntities','lockableEntities']){const a=variable(oldCompiler,name).init,b=variable(newCompiler,name).init;add(a.start,a.end,built.slice(b.start,b.end),'compileStoryBiblePrompt.'+name);}
const declaration=oldCompiler.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id?.name==='presentEntities'));
add(declaration.start,declaration.start,'const matchingSource = normalizeChineseNameForMatching(cleanSourceText);\n  ','compileStoryBiblePrompt.matchingSource');
const cls=oldTree.program.body.find(n=>n.type==='ClassDeclaration'&&n.id?.name==='GeminiApiAdapter');
const method=cls?.body.body.find(n=>n.key?.name==='callGeminiApi');if(!method)throw Error('Installed API adapter missing');
const tail=method.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id?.name==='textPart'));
if(!tail||!original.slice(tail.start,tail.end).includes('data.candidates?.[0]?.content?.parts?.[0]?.text'))throw Error('Unexpected API reader; re-audit before patching');
const last=method.body.body.at(-1);if(last.type!=='ReturnStatement')throw Error('Unexpected API method tail');
add(tail.start,last.end,'return readGeminiTextResponse(data);','GeminiApiAdapter.callGeminiApi.reader');
const helpers=['normalizeChineseNameForMatching','readGeminiTextResponse'].map(name=>{if(oldTree.program.body.some(n=>n.id?.name===name))throw Error('Helper name already exists: '+name);const n=fn(newTree,name);return built.slice(n.start,n.end);}).join('\n\n');
const insertion=oldTree.program.body.find(n=>n.type!=='ImportDeclaration').start;add(insertion,insertion,helpers+'\n\n','new pure helpers');
const ordered=[...changes].sort((a,b)=>a.start-b.start||a.end-b.end);for(let i=1;i<ordered.length;i++)if(ordered[i].start<ordered[i-1].end)throw Error('Overlapping patch ranges');
let patched=original;for(const p of [...ordered].reverse())patched=patched.slice(0,p.start)+p.text+patched.slice(p.end);parse(patched);
// Every byte outside the declared ranges comes directly from the installed baseline.
await fs.writeFile(path.join(stage,mainKey),patched);
const output=path.join(root,'app-fix12.asar');await asar.createPackageWithOptions(stage,output,{unpack:'**/node_modules/playwright-core/**/*'});
const beforeList=asar.listPackage(baseline),afterList=asar.listPackage(output);if(JSON.stringify(beforeList)!==JSON.stringify(afterList))throw Error('Archive entry list changed');
const changed=[];for(const file of beforeList){const key=file.replace(/^[\\/]/u,'');const stat=asar.statFile(baseline,key);if(stat.files||stat.link)continue;if(!asar.extractFile(baseline,key).equals(asar.extractFile(output,key)))changed.push(file);}
if(changed.length!==1||changed[0].replaceAll('\\','/')!=='/out/main/index.js')throw Error('Unrelated archive changes: '+JSON.stringify(changed));
const report={builtAt:new Date().toISOString(),baselineHash:expected.archiveHash,resultHash:hash(await fs.readFile(output)),changedArchiveFiles:changed,patches:ordered.map(p=>({label:p.label,originalRange:[p.start,p.end],originalHash:hash(original.slice(p.start,p.end)),replacementHash:hash(p.text)})),allOtherArchiveFilesByteIdentical:true,promptsAndRendererPreserved:true,sourceStep1Preserved:patched.includes('story-source-step1.cjs'),apiModelsPreserved:['gemini-3.5-flash-lite','gemini-3.1-flash-lite'].every(n=>patched.includes(n))};
if(!report.sourceStep1Preserved||!report.apiModelsPreserved)throw Error('Installed capabilities not preserved');
await fs.writeFile(path.join(root,'package-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

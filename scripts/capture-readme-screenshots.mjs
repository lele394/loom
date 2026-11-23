import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const screenshotsRoot = path.join(root, 'docs/screenshots');
const outputRoot = path.join(screenshotsRoot, 'stock-themes');
const stagingRoot = path.join(screenshotsRoot, `.stock-themes-${process.pid}`);
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'loom-readme-preview-'));
const palettes = ['lavender', 'sakura', 'sage', 'ocean', 'midnight', 'graphite'];
const modes = ['light', 'dark'];
const features = [
  { id: 'dashboard', route: '/', selector: '.hero h1', label: 'Dashboard' },
  { id: 'library', route: '/library', selector: '.library-page', label: 'Library' },
  { id: 'project-overview', route: null, selector: '.stat-row', label: 'Project overview' },
  { id: 'literature', route: null, selector: '.table tbody tr', label: 'Project literature' },
];

async function freePorts(count) {
  const servers = Array.from({ length: count }, () => net.createServer());
  try {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
          }),
      ),
    );
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(
      servers.map((server) =>
        server.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve(),
      ),
    );
  }
}

function runBuild() {
  const result = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('The production build failed; preview screenshots were not generated.');
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('The temporary Loom server exited before it was ready.');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting while the server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the temporary Loom server.');
}

async function driverRequest(base, endpoint, method = 'GET', body) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Firefox WebDriver ${method} ${endpoint} failed (${response.status}): ${JSON.stringify(result)}`,
    );
  }
  return result;
}

async function executeAsync(driver, sessionId, script, args = []) {
  const result = await driverRequest(driver, `/session/${sessionId}/execute/async`, 'POST', {
    script,
    args,
  });
  return result.value;
}

async function waitForSelector(driver, sessionId, selector) {
  const found = await executeAsync(
    driver,
    sessionId,
    `const selector=arguments[0],done=arguments[arguments.length-1],start=Date.now();
     (function check(){if(document.querySelector(selector)){done(true);return}
       if(Date.now()-start>20000){done(false);return}setTimeout(check,200)})()`,
    [selector],
  );
  if (!found) throw new Error(`Timed out waiting for "${selector}" in the preview app.`);
}

async function seedPreviewData(driver, sessionId) {
  const setup = await executeAsync(
    driver,
    sessionId,
    `const done=arguments[arguments.length-1];
     fetch('/api/v1/auth/setup',{method:'POST',headers:{'content-type':'application/json'},
       body:JSON.stringify({username:'preview-curator',password:'LoomPreview!8642',
         displayName:'Alex Morgan',timezone:'UTC',starterProject:false})})
       .then(async response=>done({status:response.status,body:await response.json()}))
       .catch(error=>done({error:error.message}))`,
  );
  if (setup.status !== 201) {
    throw new Error(`Could not initialize the isolated preview workspace: ${JSON.stringify(setup)}`);
  }

  const result = await executeAsync(
    driver,
    sessionId,
    `const done=arguments[arguments.length-1],csrf=arguments[0];
     (async()=>{
       const call=async(path,body,method='POST')=>{
         const response=await fetch('/api/v1'+path,{method,
           headers:{'content-type':'application/json','x-csrf-token':csrf},
           ...(body===undefined?{}:{body:JSON.stringify(body)})});
         const data=await response.json();
         if(!response.ok)throw Error(path+' ('+response.status+'): '+(data.error?.message||''));
         return data;
       };
       const projects=[];
       for(const project of [
         {name:'Computational Neuroscience',color:'ocean',description:'Neural signals, adaptive systems, and translational research.'},
         {name:'Climate Systems',color:'sage',description:'Regional climate dynamics and resilient cities.'},
         {name:'Human-Centered AI',color:'sakura',description:'Trustworthy tools shaped around people and practice.'}
       ]) projects.push(await call('/projects',project));

       const papers=[
         [0,'Closed-loop stimulation for adaptive motor rehabilitation',['Maya Chen','Elias Romero','Nina Patel'],2025,'Nature Biomedical Engineering','reading','Adaptive stimulation pairs neural decoding with patient-specific feedback for motor rehabilitation.'],
         [0,'Neural decoding with low-power edge models',['Jonah Park','A. W. Singh'],2024,'PLOS Computational Biology','unread','Efficient models bring robust neural decoding to resource-constrained clinical applications.'],
         [0,'Evaluating cross-session signal drift',['Leila Haddad','Marco Silva'],2023,'IEEE Transactions on Neural Systems and Rehabilitation Engineering','reviewed','A comparison of calibration strategies under cross-session neural signal drift.'],
         [1,'Urban heat islands under compound extremes',['Amara Okafor','Luca Bianchi'],2025,'Nature Cities','reading','Satellite observations reveal how heat and humidity extremes compound across cities.'],
         [1,'Coupled ocean–atmosphere signals at seasonal scales',['Sofia Laurent','Daniel Kim'],2024,'Journal of Climate','unread','A multi-basin analysis of coupled signals and their role in regional forecasts.'],
         [1,'Open satellite pipelines for climate adaptation',['Priya Nair','Ethan Brooks'],2022,'Environmental Research Letters','reviewed','An open workflow translates satellite observations into local adaptation indicators.'],
         [2,'Measuring uncertainty in human–AI decision support',['Elena Fischer','Ravi Desai'],2025,'CHI Conference on Human Factors in Computing Systems','unread','Interaction patterns communicate model uncertainty while preserving human agency.'],
         [2,'Small language models for trustworthy field research',['Mina Al-Khatib','Oliver Grant'],2024,'ACM Conference on Computer-Supported Cooperative Work','reading','A field study of compact language models in privacy-sensitive workflows.'],
         [2,'Design patterns for accountable automation',['Gabriela Costa','Noah Williams'],2023,'Proceedings of the ACM on Human-Computer Interaction','reviewed','Interaction patterns make automated decisions easier to inspect and contest.']
       ];
       for(const [index,title,authors,year,venue,readingStatus,abstract] of papers)
         await call('/references',{title,authors,year,venue,readingStatus,abstract,type:'article',projectId:projects[index].id});

       await call('/notes',{title:'Adaptive stimulation — reading notes',template:'research',
         projectId:projects[0].id,blocks:[
           {type:'h2',text:'Research question'},
           {type:'paragraph',text:'How can feedback-driven stimulation adapt to changing neural signals during rehabilitation?'},
           {type:'quote',text:'The most useful interventions respond to the person, not just the signal.'},
           {type:'h2',text:'Ideas to follow up'},
           {type:'bullet',text:'Compare calibration stability across sessions.'},
           {type:'bullet',text:'Review patient-reported outcomes alongside decoding accuracy.'}
         ]});

       const board=await call('/projects/'+projects[0].id+'/board',undefined,'GET');
       const today=new Date().toISOString().slice(0,10);
       for(const [title,priority] of [
         ['Review decoder robustness','high'],
         ['Prepare journal-club questions','normal'],
         ['Compare cross-session baselines','urgent']
       ]) await call('/tasks',{title,projectId:projects[0].id,columnId:board.columns[0].id,priority,dueDate:today});
       done({csrfToken:csrf,projectId:projects[0].id});
     })().catch(error=>done({error:error.message}))`,
    [setup.body.csrfToken],
  );
  if (result.error) throw new Error(`Could not seed the isolated preview workspace: ${result.error}`);
  return result;
}

async function captureAll(driver, sessionId, appUrl, csrfToken, projectId) {
  for (const palette of palettes) {
    const themeDir = path.join(stagingRoot, palette);
    mkdirSync(themeDir, { recursive: true });
    for (const mode of modes) {
      const updated = await executeAsync(
        driver,
        sessionId,
        `const done=arguments[arguments.length-1],csrf=arguments[0],mode=arguments[1],palette=arguments[2];
         fetch('/api/v1/settings/appearance',{method:'PATCH',
           headers:{'content-type':'application/json','x-csrf-token':csrf},
           body:JSON.stringify({mode,palette})})
           .then(async response=>done({ok:response.ok,data:await response.json()}))
           .catch(error=>done({error:error.message}))`,
        [csrfToken, mode, palette],
      );
      if (!updated.ok) {
        throw new Error(`Could not select the ${palette} ${mode} theme: ${JSON.stringify(updated.data)}`);
      }

      for (const feature of features) {
        const route =
          feature.id === 'project-overview'
            ? `/projects/${projectId}`
            : feature.id === 'literature'
            ? `/projects/${projectId}/literature`
              : feature.route;
        await driverRequest(driver, `/session/${sessionId}/url`, 'POST', { url: `${appUrl}${route}` });
        await waitForSelector(driver, sessionId, feature.selector);
        await executeAsync(
          driver,
          sessionId,
          `const done=arguments[arguments.length-1];
           window.scrollTo(0,0);document.activeElement?.blur();
           Promise.resolve(document.fonts?.ready).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))))`,
        );
        const screenshot = await driverRequest(
          driver,
          `/session/${sessionId}/screenshot`,
        );
        const filename = `${mode}-${feature.id}.png`;
        writeFileSync(
          path.join(themeDir, filename),
          Buffer.from(screenshot.value, 'base64'),
        );
        console.log(`Captured ${palette}/${filename}`);
      }
    }
  }
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 3000).unref();
  });
}

async function main() {
  const [driverPort, appPort] = await freePorts(2);
  const driverUrl = `http://127.0.0.1:${driverPort}`;
  const appUrl = `http://127.0.0.1:${appPort}`;
  let browserDriver = null;
  let appServer = null;
  let sessionId = null;

  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  try {
    runBuild();
    browserDriver = spawn('geckodriver', ['--host', '127.0.0.1', '--port', String(driverPort)], {
      cwd: root,
      stdio: 'ignore',
    });
    appServer = spawn(process.execPath, ['--import', 'tsx', 'scripts/start.ts'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(appPort),
        LOOM_DATA_DIR: dataDir,
      },
      stdio: 'inherit',
    });
    await waitForServer(`${appUrl}/api/v1/auth/session`, appServer);

    const created = await driverRequest(driverUrl, '/session', 'POST', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': { args: ['-headless'] },
        },
      },
    });
    sessionId = created.value.sessionId;
    await driverRequest(driverUrl, `/session/${sessionId}/window/rect`, 'POST', {
      x: 0,
      y: 0,
      width: 1600,
      height: 1050,
    });
    await driverRequest(driverUrl, `/session/${sessionId}/url`, 'POST', { url: appUrl });
    const { csrfToken, projectId } = await seedPreviewData(driverUrl, sessionId);
    await captureAll(driverUrl, sessionId, appUrl, csrfToken, projectId);

    rmSync(outputRoot, { recursive: true, force: true });
    renameSync(stagingRoot, outputRoot);
    console.log(`Wrote 48 stock-theme screenshots to ${path.relative(root, outputRoot)}.`);
  } finally {
    if (sessionId) {
      await driverRequest(driverUrl, `/session/${sessionId}`, 'DELETE').catch(() => undefined);
    }
    await stop(appServer);
    await stop(browserDriver);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

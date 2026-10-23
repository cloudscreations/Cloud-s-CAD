from playwright.sync_api import sync_playwright
import time, json
MOCK = """
window.__mockRx = [];
window.__openSerial = async () => {
  let cb = () => {}; let tgt = {h:0,b:0};
  return {
    onData: (fn) => { cb = fn; setTimeout(() => cb('start\\necho:Marlin\\n'), 5); },
    write: async (s) => { for (const line of s.split('\\n').filter(Boolean)) { window.__mockRx.push(line);
        setTimeout(() => { const m=/^M104 S(\\d+)/.exec(line); if(m) tgt.h=+m[1];
          cb(/^M105/.test(line) ? `ok T:25.0 /${tgt.h}.0 B:24.0 /${tgt.b}.0\\n` : 'ok\\n'); }, 1); } },
    close: async () => {},
  };
};
"""
CUBE = """() => {
  const b=[[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]];
  const f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const pos=new Float32Array(f.flatMap(t=>t.flatMap(i=>b[i])));
  window.__cloud.setModel(pos); window.__cloud.setTab('print');
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={'width':1400,'height':900})
    pg.add_init_script("localStorage.setItem('cloudcad-welcomed','1')")
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto('file:///tmp/clouds-cad/clouds-cad.html')
    pg.evaluate(MOCK)
    pg.evaluate(CUBE); time.sleep(0.5)
    print('info:', pg.inner_text('#pModelInfo'))
    pg.screenshot(path='/tmp/clouds-cad/shots/print0.png')
    pg.click('#pSlice')
    pg.wait_for_function("document.getElementById('pStats').textContent.length > 0", timeout=60000)
    print('stats:', pg.inner_text('#pStats').replace('\n',' '))
    pg.fill('#pvLayer','45'); pg.dispatch_event('#pvLayer','input'); time.sleep(0.3)
    print(pg.inner_text('#pvLayerTxt'))
    pg.screenshot(path='/tmp/clouds-cad/shots/print1.png')
    # connect over the pretend USB printer and print
    pg.click('#cConnect'); pg.wait_for_function("!document.getElementById('cLive').hidden", timeout=10000)
    print('state:', pg.inner_text('#cState'), '|', pg.inner_text('#cTemps'))
    pg.click('#cPreheat'); time.sleep(0.5)
    print('rx after preheat:', pg.evaluate("window.__mockRx.slice(-3)"))
    pg.click('[data-jog="x+"]'); time.sleep(0.3)
    print('jog:', pg.evaluate("window.__mockRx.slice(-3)"))
    pg.click('#cStart'); time.sleep(1.5)
    print('printing:', pg.inner_text('#cState'), '| lines sent', pg.evaluate("window.__mockRx.length"))
    pg.click('#cPause'); time.sleep(0.3); a=pg.evaluate("window.__mockRx.length"); time.sleep(0.5); b=pg.evaluate("window.__mockRx.length")
    print('paused, stable:', a, b, pg.inner_text('#cState'))
    pg.click('#cEstop'); time.sleep(0.3)
    print('estop:', pg.evaluate("window.__mockRx.slice(-1)"), pg.inner_text('#cState'))
    pg.screenshot(path='/tmp/clouds-cad/shots/print2.png')
    print('errors:', errs)
    br.close()

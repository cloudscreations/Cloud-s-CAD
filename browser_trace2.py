from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1400,"height":850}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.add_init_script("try{localStorage.setItem('cloudcad-welcomed','1')}catch(e){}")
    pg.goto("file:///tmp/clouds-cad/clouds-cad.html")
    pg.set_input_files("#imgFile","/tmp/clouds-cad/shots/profiles.png")
    pg.locator("summary:has-text('Auto-trace')").click()
    pg.fill("#imgW","8")
    pg.click("#imgGo"); pg.wait_for_timeout(600)
    print(pg.evaluate("()=>document.getElementById('hint').textContent"))
    print(pg.evaluate("()=>{const c=window.__cloud;return {n:c.state.doc.ents.length,rep:document.getElementById('report').textContent}}"))
    pg.click("[data-tool=select]")
    pg.screenshot(path="shots/trace_profiles.png")
    print(errs); b.close()

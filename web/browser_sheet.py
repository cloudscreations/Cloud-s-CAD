from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1400,"height":850},accept_downloads=True); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.add_init_script("try{localStorage.setItem('cloudcad-welcomed','1')}catch(e){}")
    pg.goto("file:///tmp/clouds-cad/clouds-cad.html")
    pg.set_input_files("#imgFile","/tmp/clouds-cad/shots/profiles.png")
    pg.locator("summary:has-text('Auto-trace')").click()
    pg.fill("#imgW","8"); pg.click("#imgGo"); pg.wait_for_timeout(700)
    print(pg.evaluate("()=>({n:window.__cloud.state.doc.ents.length,rep:document.getElementById('report').textContent})"))
    pg.screenshot(path="shots/trace_smooth.png")
    # keep only first shape: double click on it, invert selection -> simpler: select all and set height of whole thing
    pg.click("[data-tab=machine]"); pg.wait_for_timeout(300)
    with pg.expect_download() as d: pg.click("#dlSheet")
    d.value.save_as("shots/sheet.svg")
    print(errs); b.close()

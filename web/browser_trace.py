from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1400,"height":850})
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("file:///tmp/clouds-cad/clouds-cad.html")
    pg.set_input_files("#imgFile","/tmp/clouds-cad/shots/blob.png")
    pg.fill("#imgW","8"); pg.click("#imgGo"); pg.wait_for_timeout(500)
    r=pg.evaluate("()=>{const c=window.__cloud;const b=c.S.bbox(c.state.doc.ents);return {n:c.state.doc.ents.length,w:b.w,h:b.h,rep:document.getElementById('report').textContent}}")
    print(r, errs)
    # use as front+side view for carve
    pg.screenshot(path="/tmp/clouds-cad/shots/trace.png")
    b.close()

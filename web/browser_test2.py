from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(args=["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg=b.new_page(viewport={"width":1400,"height":850}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.on("dialog",lambda d:d.accept("4"))
    pg.add_init_script("try{localStorage.setItem('cloudcad-welcomed','1')}catch(e){}")
    pg.goto("file:///tmp/clouds-cad/clouds-cad.html")
    pg.set_input_files("#imgFile","/tmp/clouds-cad/shots/blob.png")
    pg.click("#bgUse"); pg.wait_for_timeout(500)
    pg.click("#bgFit")
    pg.click("[data-tool=curve]")
    box=pg.locator("#cv").bounding_box()
    pts=[(300,300),(380,230),(480,215),(560,260),(600,330),(560,400),(470,420),(360,390)]
    for x,y in pts: pg.mouse.click(box["x"]+x,box["y"]+y)
    pg.mouse.click(box["x"]+300,box["y"]+300)
    pg.mouse.move(box["x"]+700,box["y"]+300)
    pg.wait_for_timeout(200)
    print(pg.evaluate("()=>({n:window.__cloud.state.doc.ents.length,rep:document.getElementById('report').textContent,bg:!!window.__cloud.state.bg})"))
    pg.screenshot(path="shots/curve_dark.png")
    pg.click("[data-tab=machine]"); pg.wait_for_timeout(300)
    pg.screenshot(path="shots/machine_dark.png")
    print(errs)
    b.close()

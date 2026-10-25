import sys, json
from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg=b.new_page(viewport={"width":1400,"height":850})
    pg.on("pageerror",lambda e:errs.append("pageerror: "+str(e)))
    pg.on("console",lambda m: errs.append("console."+m.type+": "+m.text) if m.type in("error","warning") else None)
    pg.add_init_script("try{localStorage.setItem('cloudcad-welcomed','1')}catch(e){}")
    pg.goto("file:///tmp/clouds-cad/clouds-cad.html")
    pg.wait_for_timeout(300)
    txt=open("/tmp/clouds-cad/real_freecad.dxf").read()
    pg.evaluate("t=>window.__cloud.loadText('real.dxf',t)",txt)
    pg.wait_for_timeout(300)
    pg.screenshot(path="shots/draw_real.png")
    # draw by real mouse: rectangle
    pg.evaluate("()=>{const c=window.__cloud;c.state.doc.clear();c.state.sel.clear();c.onChange();c.draw.fit();}")
    pg.click("[data-tool=rect]")
    box=pg.locator("#cv").bounding_box()
    x0=box["x"]+200;y0=box["y"]+150
    pg.mouse.click(x0,y0); pg.mouse.move(x0+250,y0+160,steps=5); pg.mouse.click(x0+250,y0+160)
    pg.click("[data-tool=circle]")
    pg.mouse.click(x0+400,y0+200); pg.mouse.move(x0+450,y0+200,steps=4); pg.mouse.click(x0+450,y0+200)
    pg.click("[data-tool=select]")
    pg.mouse.click(x0+125,y0)
    pg.wait_for_timeout(200)
    n=pg.evaluate("window.__cloud.state.doc.ents.length")
    print("entities after real mouse drawing:",n)
    pg.screenshot(path="shots/draw_mouse.png")
    # 3D
    pg.click("#toggle23"); pg.wait_for_timeout(500)
    pg.fill("#exDepth","3"); pg.click("#exGo"); pg.wait_for_timeout(800)
    pg.screenshot(path="shots/d3.png")
    gl=pg.evaluate("()=>!document.getElementById('noGL').hidden")
    print("noGL shown:",gl)
    pg.click("[data-tab=machine]"); pg.wait_for_timeout(300)
    pg.screenshot(path="shots/machine.png")
    b.close()
print("\n".join(errs) or "no console errors")

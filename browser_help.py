from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1400,"height":850}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("file:///tmp/clouds-cad/clouds-cad.html"); pg.wait_for_timeout(400)
    print("welcome open:",pg.evaluate("document.getElementById('welcome').open"))
    pg.screenshot(path="shots/welcome.png")
    pg.click("[data-go=dxf]"); pg.wait_for_timeout(700)
    pg.screenshot(path="shots/tour.png")
    pg.click("#tourClose")
    pg.click("#helpBtn"); pg.fill("#helpSearch","wrong size"); pg.wait_for_timeout(200)
    pg.click("#helpList .topic >> nth=0"); pg.screenshot(path="shots/help.png")
    pg.reload(); pg.wait_for_timeout(300)
    print("welcome after skip+reload:",pg.evaluate("document.getElementById('welcome').open"))
    print(errs); b.close()

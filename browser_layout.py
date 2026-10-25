from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1400,'height':850})
    pg.add_init_script("localStorage.setItem('cloudcad-welcomed','1')")
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file:///tmp/clouds-cad/clouds-cad.html')
    pg.set_input_files('input[type=file][accept*=".dxf"]','/tmp/clouds-cad/real_freecad.dxf'); pg.wait_for_timeout(500)
    pg.screenshot(path='/tmp/clouds-cad/shots/layout.png')
    # tool buttons all visible without scrolling the left bar?
    print(pg.evaluate("(()=>{const t=document.getElementById('tools');return [t.scrollHeight,t.clientHeight]})()"))
    print(pg.evaluate("(()=>{const r=document.getElementById('tools').getBoundingClientRect();return [r.width]})()"))
    print(errs)

import asyncio, json, hmac, hashlib, struct, time, base64, sys, urllib.request
from playwright.async_api import async_playwright
import os
STATIC=os.environ.get('STATIC')
BASE='http://127.0.0.1:8091/index.html' if STATIC else 'http://127.0.0.1:8090/exec'
ADMIN='http://127.0.0.1:8091/admin.html' if STATIC else BASE+'?p=admin'
OUT=sys.argv[1] if len(sys.argv)>1 else '/home/claude/manual/img/'
def totp(secret):
    key=base64.b32decode(secret); c=int(time.time()//30); h=hmac.new(key,struct.pack('>Q',c),hashlib.sha1).digest(); o=h[19]&15
    return str((struct.unpack('>I',h[o:o+4])[0]&0x7fffffff)%1000000).zfill(6)
def rpc(fn,*args):
    r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8090/rpc',data=json.dumps({'fn':fn,'args':list(args)}).encode(),headers={'Content-Type':'application/json'})); return json.loads(r.read())['result']
errors=[]
async def main():
    pin=None
    # 事務所でログインして初回番号を取る
    if STATIC: rpc('api','admin.login',{'pw':'test-pass-1234','otp':totp('JBSWY3DPEHPK3PXP')})
    adm=rpc('api','admin.login',{'pw':'test-pass-1234','otp':totp('JBSWY3DPEHPK3PXP')}); T=adm['_t']
    cl=rpc('api','admin.client',{'_t':T,'client':'9999'}); pin=[r for r in cl['rows'] if r['emp']=='**000001'][0]['pin']; print('pin',pin)
    async with async_playwright() as p:
        b=await p.chromium.launch(); mctx=await b.new_context(viewport={'width':390,'height':760}, device_scale_factor=2); pg=await mctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
        await pg.goto(BASE); await pg.wait_for_selector('#code'); await pg.fill('#code','9999000001'); await pg.screenshot(path=OUT+'e1_code.png')
        await pg.click('#login'); await pg.wait_for_selector('#lpin', state='visible'); await pg.fill('#pin', pin); await pg.screenshot(path=OUT+'e2_pin.png')
        await pg.click('#login'); await pg.wait_for_selector('.card h1'); await pg.screenshot(path=OUT+'e3_consent.png')
        await pg.click('#next'); await pg.wait_for_timeout(400); await pg.screenshot(path=OUT+'e4_check.png')
        await pg.click('[data-k=p_changed][data-v=no]'); await pg.click('#next'); await pg.wait_for_timeout(400)
        await pg.click('[data-k=head_is_self][data-v=yes]'); await pg.click('#next'); await pg.wait_for_timeout(400); await pg.screenshot(path=OUT+'e5_salary.png')
        for sel in ['#next','[data-k=has_other_income][data-v=no]','#next','[data-k=other_employer][data-v=no]','#next','#next','[data-k=since_jan][data-v=yes]','#next','[data-k=has_spouse][data-v=yes]','#next','#next']:
            await pg.click(sel); await pg.wait_for_timeout(350)
        await pg.screenshot(path=OUT+'e6_spouse_income.png')
        await pg.type('[name=spi_amount]','1300000'); await pg.click('#next'); await pg.wait_for_timeout(1200); await pg.screenshot(path=OUT+'e7_family.png')
        await pg.click('[data-edit="0"]'); await pg.wait_for_timeout(300); await pg.screenshot(path=OUT+'e8_family_edit.png')
        await pg.click('#fsave'); await pg.wait_for_timeout(500); await pg.click('[data-edit="1"]'); await pg.wait_for_timeout(300); await pg.click('#fz0'); await pg.click('#fsave'); await pg.wait_for_timeout(500)
        await pg.click('#next'); await pg.wait_for_timeout(400); await pg.click('[data-k=has_life][data-v=yes]'); await pg.wait_for_timeout(600); await pg.screenshot(path=OUT+'e9_cert.png')
        await pg.set_input_files('[data-cam=cert]', '/tmp/sample_cert.png'); await pg.wait_for_timeout(3000); await pg.screenshot(path=OUT+'e10_cert_read.png', full_page=True)
        await pg.click('[data-ok]'); await pg.wait_for_timeout(600)
        for sel in ['#next','[data-k=has_jishin][data-v=no]','#next','[data-k=has_shaho][data-v=no]','#next','[data-k=has_kyosai][data-v=no]','#next','[data-k=has_jutaku][data-v=no]','#next']:
            await pg.click(sel); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT+'e11_compare.png', full_page=True); await pg.click('#next'); await pg.wait_for_timeout(700); await pg.screenshot(path=OUT+'e12_done.png')
        await pg.click('#menu'); await pg.wait_for_timeout(300); await pg.screenshot(path=OUT+'e13_menu.png')
        # 2回目：開き直すと自動で入る
        pg2=await mctx.new_page()
        await pg2.goto(BASE); await pg2.wait_for_selector('#menu', state='visible'); auto = await pg2.inner_text('#who'); await pg2.screenshot(path=OUT+'e14_auto.png'); print('auto-login as', auto)
        # 事務所画面（PC幅）
        ad=await b.new_page(viewport={'width':1100,'height':800})
        ad.on('pageerror', lambda e: errors.append('admin:'+str(e)))
        await ad.goto(ADMIN); await ad.wait_for_selector('#pw'); await ad.fill('#pw','test-pass-1234'); await ad.fill('#otp', totp('JBSWY3DPEHPK3PXP')); await ad.click('#lg'); await ad.wait_for_selector('table'); await ad.screenshot(path=OUT+'a1_home.png')
        await ad.click('text=設定・取り込み'); await ad.wait_for_timeout(300); await ad.screenshot(path=OUT+'a2_settings.png', full_page=True)
        await ad.click('text=サンプル株式会社'); await ad.wait_for_selector('text=提出済みをCSVで出す');
        if await ad.query_selector('text=会社用ページのURLを作る'): await ad.click('text=会社用ページのURLを作る'); await ad.wait_for_timeout(600)
        await ad.screenshot(path=OUT+'a3_client.png')
        await ad.click('text=開く'); await ad.wait_for_selector('text=判定結果'); await ad.wait_for_timeout(800); await ad.screenshot(path=OUT+'a4_emp.png', full_page=True)
        # CSV出力（ダウンロード）
        await ad.click('text=の一覧'); await ad.wait_for_selector('text=全員分を出す')
        await ad.wait_for_timeout(300)
        async with ad.expect_download() as dl: await ad.click('text=全員分を出す')
        d=await dl.value; path=await d.path(); print('download', d.suggested_filename, open(path,'rb').read()[:60])
        # 会社用ページ
        cl2=rpc('api','admin.client',{'_t':T,'client':'9999'}); curl=cl2['company']['url']
        co=await b.new_page(viewport={'width':600,'height':900}); co.on('pageerror', lambda e: errors.append('company:'+str(e)))
        await co.goto(curl); await co.wait_for_selector('.it'); await co.wait_for_timeout(400); await co.screenshot(path=OUT+'c1_company.png')
        await b.close()
    print('errors:', errors)
asyncio.run(main())

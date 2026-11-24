const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function seoOrigin(env=process.env){try{const u=new URL(env.PUBLIC_ORIGIN);return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash?u.origin:null;}catch{return null;}}
export function structuredData(settings,origin){
  if(!origin)return '';
  const data={
    '@context':'https://schema.org',
    '@type':'MobilePhoneRepair',
    name:settings.business_name||'RepairlyLabs',
    url:origin,
    ...(settings.tagline?{description:settings.tagline}:{}),
    ...(settings.phone?{telephone:settings.phone}:{}),
    ...(settings.email?{email:settings.email}:{}),
    address:{
      '@type':'PostalAddress',
      addressLocality:settings.city||'Varanasi',
      addressCountry:'IN',
      ...(settings.address?{streetAddress:settings.address}:{})
    },
    ...(settings.hours?{openingHours:settings.hours}:{}),
    ...(settings.map_url?{hasMap:settings.map_url}:{})
  };
  return '<script type="application/ld+json">'+JSON.stringify(data).replaceAll('</','<\\/')+'</script>';
}
export function sitemap(db,origin){const routes=['/','/repairs','/parts','/about','/contact','/privacy','/terms',...db.prepare('SELECT slug FROM services WHERE active=1 ORDER BY sort_order,id').all().map(r=>'/service/'+encodeURIComponent(r.slug)),'/part-request/'];return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+routes.map(r=>'<url><loc>'+esc(origin+r)+'</loc></url>').join('')+'</urlset>';}
export function catalogPage(db,path,settings,origin){let row,title,description,body;const service=path.match(/^\/service\/([a-z0-9-]+)$/),part=path.match(/^\/part\/(\d+)$/);if(service){row=db.prepare('SELECT title,description FROM services WHERE slug=? AND active=1').get(service[1]);if(!row)return null;title=row.title+' in '+(settings.city||'Varanasi');description=row.description;body='<p>'+esc(description)+'</p><p>Final diagnosis, replacement options, pricing and availability are confirmed by the repair team before work is approved.</p><a class="btn btn-primary" href="/repairs">Request this repair</a>';}else if(part){row=db.prepare('SELECT * FROM products WHERE id=? AND active=1 AND sample=0').get(Number(part[1]));if(!row)return null;title=row.name;description=row.description||('Spare part for '+row.brand+' '+row.model);body='<p>'+esc(description)+'</p><p>For: '+esc(row.brand+' '+row.model)+'</p><p>This is a legacy information page, not a live offer or price listing. Request a personalised quote to verify the exact variant, stock, delivery and final price.</p><a class="btn btn-primary" href="/part-request/?brand='+encodeURIComponent(row.brand)+'&amp;model='+encodeURIComponent(row.model)+'">Request price and availability</a>';}else return null;const name=settings.business_name||'RepairlyLabs';const jsonLd=service?structuredData(settings,origin):'';return '<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title+' | '+name)+'</title><meta name="description" content="'+esc(description)+'">'+(origin?'<link rel="canonical" href="'+esc(origin+path)+'">':'')+(part?'<meta name="robots" content="noindex,follow">':'')+jsonLd+'<link rel="stylesheet" href="/styles.css"><link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/repairlylabs-favicon-32.png"><link rel="icon" type="image/svg+xml" href="/assets/brand/repairlylabs-logo.svg"><link rel="shortcut icon" href="/favicon.ico"></head><body><main class="container" style="max-width:850px;padding:45px 20px"><nav aria-label="Site navigation" style="display:flex;gap:20px;flex-wrap:wrap"><a href="/">'+esc(name)+'</a><a href="/repairs">Repairs</a><a href="/parts">Parts</a><a href="/contact">Contact</a></nav><section class="form-panel" style="margin-top:30px"><h1 style="font-size:clamp(26px,5vw,44px)">'+esc(title)+'</h1>'+body+'</section><section class="form-panel" style="margin-top:20px"><h2>Contact and service details</h2><p>'+esc(settings.address||settings.city||'Varanasi')+'</p>'+(settings.hours?'<p>'+esc(settings.hours)+'</p>':'')+(settings.phone?'<p>Phone: '+esc(settings.phone)+'</p>':'')+'<a href="/contact">Ask the repair team</a><p><a href="/privacy">Privacy notice</a> · <a href="/terms">Terms &amp; policies</a></p></section></main></body></html>';}

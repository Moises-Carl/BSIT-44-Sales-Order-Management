import { demoProductImages } from './demo-products.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Opaque Catalogue references can be translated at this single adapter boundary.
// Root-relative assets or HTTPS images only; no script/data/protocol-relative URLs.
export function safeImageURL(value){
 if(typeof value!=='string'||!value.trim())return null;
 const url=value.trim();
 if(/[\u0000-\u0020\\]/.test(url))return null;
 if(url.startsWith('/')&&!url.startsWith('//'))return url;
 try{const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password?parsed.href:null;}catch{return null;}
}
export function resolveProductImage(product={}, {demo=false,resolveReference=reference=>reference}={}){
 const name=product.product_name_at_order||product.product_name||product.name||'Product';
 let reference;try{reference=resolveReference(product.image_reference);}catch{reference=null;}
 const catalogue=safeImageURL(product.image_url)||safeImageURL(reference);
 if(catalogue)return {src:catalogue,alt:product.image_alt||name+' — product photo',sample:false};
 const sample=demo?demoProductImages[product.offer_id]:null;
 if(sample)return {src:sample.src,alt:'Sample photo for '+name+': '+sample.description,sample:true};
 return {src:null,alt:'Photo unavailable for '+name,sample:false};
}
export function productThumbnail(product,options){
 const image=resolveProductImage(product,options);
 return '<span class="product-photo'+(image.src?'':' image-unavailable')+'"'+(image.sample?' title="Illustrative demo photo"':'')+'>'+(image.src?'<img src="'+escape(image.src)+'" alt="'+escape(image.alt)+'" width="96" height="96" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'')+'<span class="product-photo-fallback" role="img" aria-label="'+escape('Photo unavailable for '+(product.product_name_at_order||product.product_name||product.name||'Product'))+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-5 3 3 4-6 5 8"/></svg><span>No photo</span></span></span>';
}
export function installImageFallback(root){
 const failed=event=>{const img=event.target;if(img?.matches?.('.product-photo img'))img.parentElement.classList.add('image-unavailable');};
 root.addEventListener('error',failed,true);
 return ()=>root.removeEventListener('error',failed,true);
}

function checkLinksSkeleton() {
  const ss = SpreadsheetApp.getActive();

  // 1) Lấy URL đích ở sheet "Kết quả", ô A2
  const targetSheet = ss.getSheetByName('Kết quả');
  const targetUrl   = targetSheet.getRange('A2').getValue().trim();

}

function getAllSourceUrls() {
  const ss = SpreadsheetApp.getActive();
  const sourceSheet = ss.getSheetByName('Nguồn');
  const rawList = sourceSheet.getRange('A2:A' + sourceSheet.getLastRow())
                             .getValues()
                             .flat()
                             .filter(u => u);

  let sourceUrls = [];
  rawList.forEach(item => {
    if (item.toLowerCase().endsWith('.xml')) {
      sourceUrls = sourceUrls.concat(getUrlsFromSitemap(item));
    } else {
      sourceUrls.push(item);
    }
  });

  // Giữ lại .html / .htm
  sourceUrls = sourceUrls.filter(u => /\.html?$/i.test(u));

  // Chỉ /blog…
  const blogPattern = /^https:\/\/fastcare\.vn\/blog(\/|$)/i;
  sourceUrls = sourceUrls.filter(u => blogPattern.test(u));

  return sourceUrls;
}

/**
 * Đệ quy: cho vào URL sitemap (có thể là sitemap-index),
 * trả về mảng URL bài viết (.html, .htm, v.v.).
 */
function getUrlsFromSitemap(u) {
  const xml   = UrlFetchApp.fetch(u, {muteHttpExceptions:true}).getContentText();
  const doc   = XmlService.parse(xml);
  const root  = doc.getRootElement();
  const ns    = root.getNamespace();           // 👈 lấy namespace
  const name  = root.getName();

  if (name === 'urlset') {
    return root.getChildren('url', ns)          // 👈 truyền ns
               .map(n => n.getChild('loc', ns).getText())
               .filter(x => !x.endsWith('.xml'));
  }

  if (name === 'sitemapindex') {
    const subs = root.getChildren('sitemap', ns)
                     .map(n => n.getChild('loc', ns).getText());
    let all = [];
    subs.forEach(s => all = all.concat(getUrlsFromSitemap(s)));
    return all;
  }
  return [];
}

/**
 * Trả về mảng anchor text trỏ tới targetUrl, tìm thấy trong urlNguon.
 * Bỏ qua phần menu/navigation để tránh đếm nhầm.
 */
/* quét song song một lô URL */
function scanPagesInBatch(urls, targetUrl) {
  const responses = UrlFetchApp.fetchAll(
    urls.map(u => ({ url: u, muteHttpExceptions: true }))
  );
  return responses.map((resp, idx) => {
    const html = resp.getContentText()
      .replace(/<nav[\s\S]*?<\/nav>|<div[^>]*role=["']dialog["'][\s\S]*?<\/div>/gi,'');
    const anchors = extractAnchors(html, targetUrl);
    return { url: urls[idx], anchors };
  });
}


function extractAnchors(bodyHtml, targetUrl) {
  // Chuẩn bị Regex để match link tuyệt đối hoặc tương đối
  const fullEsc = targetUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathEsc = targetUrl.replace(/^https?:\/\/[^/]+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRe = new RegExp(
    `<a[^>]*?href=["'][^"']*(?:${fullEsc}|${pathEsc})[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>`,
    'gi'
  );

  const anchors = [];
  let m;
  while ((m = linkRe.exec(bodyHtml)) !== null) {
    const raw  = m[1].replace(/<[^>]+>/g, '').trim();
    anchors.push(HtmlService.createHtmlOutput(raw).getContent() || '(anchor trống)');
  }
  return [...new Set(anchors)];
}


function writeResults() {
  const ss = SpreadsheetApp.getActive();
  const targetUrl = ss.getSheetByName('Kết quả').getRange('A2').getValue().trim();
  const sourceUrls = getAllSourceUrls();
  const resultSheet = ss.getSheetByName('Kết quả');
  resultSheet.getRange('C4:D' + resultSheet.getLastRow()).clearContent();

  const batchSize = 200;
  const writeThreshold = 1000; // Ghi khi tích lũy được 1000 hàng
  const rows = [];

  for (let i = 0; i < sourceUrls.length; i += batchSize) {
    const slice   = sourceUrls.slice(i, i + batchSize);
    const results = scanPagesInBatch(slice, targetUrl);
    results.forEach(r => r.anchors.forEach(a => rows.push([r.url, a])));

    if (rows.length >= writeThreshold || i === sourceUrls.length - 1) {
      resultSheet.getRange(resultSheet.getLastRow() + 1, 3, rows.length, 2).setValues(rows);
      rows.length = 0;
      Utilities.sleep(1000);
    }
  }
  SpreadsheetApp.flush();
  Logger.log('✅ Đã quét ' + sourceUrls.length + ' URL.');
}

function quickTest() {
  const targetUrl = SpreadsheetApp.getActive()
                     .getSheetByName('Kết quả')
                     .getRange('A2').getValue().trim();

  const urls = [
    'https://fastcare.vn/blog/thu-thuat-may-tinh',
    'https://fastcare.vn/blog/tai-steam.html',
    'https://fastcare.vn/blog/iphone-17.html',
    'https://fastcare.vn/blog/bang-gia-thay-man-hinh-iphone-11.html',
    'https://fastcare.vn/blog/man-hinh-iphone-11-bao-nhieu-inch.html',
    'https://fastcare.vn/blog/iphone-11-tu-tat-nguon-roi-mo-lai.html',
    'https://fastcare.vn/blog/man-hinh-iphone-11-pro-bi-soc-xanh.html',
    'https://fastcare.vn/blog/thay-man-hinh-iphone-thai-ha.html',
    'https://fastcare.vn/blog/sua-dien-thoai-thai-ha.html'
  ];                               // 👈 thêm / bớt tùy ý

  const results = scanPagesInBatch(urls, targetUrl);
   results.forEach(r =>
     Logger.log(r.url + ' → ' + (r.anchors.join(' | ') || 'Không thấy'))
  );
}


function clearTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
}

function processBatch() {
  const BATCH = 200;
  const props = PropertiesService.getScriptProperties();

  /* lấy danh sách URL đã cache */
  let urls = props.getProperty('cachedUrls');
  if (!urls) {
    cacheSourceUrls();
    urls = props.getProperty('cachedUrls');
  }
  urls = JSON.parse(urls);

  const start = Number(props.getProperty('index') || 0);
  if (start >= urls.length) {
    props.deleteAllProperties();
    Logger.log('🎉 Hoàn tất ' + urls.length + ' URL');
    return;
  }

  const slice = urls.slice(start, start + BATCH);
  const ss    = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Kết quả');
  const targetUrl = sheet.getRange('A2').getValue().trim();

  sheet.getRange('B2').setValue(`Đang quét ${start + 1}-${Math.min(start + BATCH, urls.length)}/${urls.length}`);

  const rows = [];
  scanPagesInBatch(slice, targetUrl).forEach(r => r.anchors.forEach(a => rows.push([r.url, a])));
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 3, rows.length, 2).setValues(rows);

  props.setProperty('index', start + BATCH);

  /* reset trigger */
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processBatch').timeBased().after(60 * 1000).create();

  Logger.log(`✓ Xong ${start}-${start + slice.length - 1}`);
}


function cacheSourceUrls() {
  const urls = getAllSourceUrls();                       // tải sitemap 1 lần
  PropertiesService.getScriptProperties()
                   .setProperty('cachedUrls', JSON.stringify(urls));
  Logger.log('Đã cache ' + urls.length + ' URL.');
}

function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (response.getResponseCode() === 200) return response;
      if (response.getResponseCode() === 429) {
        Utilities.sleep(5000 * (i + 1));
        continue;
      }
      throw new Error(`HTTP ${response.getResponseCode()}`);
    } catch (e) {
      Logger.log(`Lỗi ở ${url}: ${e}`);
      if (i === maxRetries - 1) return null;
      Utilities.sleep(5000 * (i + 1));
    }
  }
  return null;
}

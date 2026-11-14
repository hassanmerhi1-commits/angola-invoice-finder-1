function cleanCategoryName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function categoryNameKey(raw) {
  return cleanCategoryName(raw).toLowerCase();
}

module.exports = { cleanCategoryName, categoryNameKey };

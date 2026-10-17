'use strict';
const { readText } = require('../text-content.cjs');
const textOf = (value) => readText(value).text;
function classifyImage(mode) {
  const value = textOf(mode)
    .toLowerCase()
    .replace(/[-_\s]/g, '');
  if (['texttoimage', 'text2image', 't2i', '文生图'].includes(value)) return 'image_text';
  if (
    ['imagetoimage', 'image2image', 'i2i', 'edit', 'imageedit', '图生图', '图片编辑'].includes(
      value
    )
  )
    return 'image_reference';
  return 'image_unknown';
}
module.exports = { classifyImage };

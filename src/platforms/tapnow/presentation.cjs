'use strict';
module.exports = {
  pattern: '\\b(Image|Video|Audio|Text)\\s*(\\d+)\\b',
  type: (text) => text.toLowerCase()
};

const fs = require('fs');
['country','province','city','district'].forEach(function(d) {
  var files = fs.readdirSync('public/geo/' + d).filter(function(f) { return f.endsWith('.json'); });
  console.log(d + ': ' + files.length + ' files');
});

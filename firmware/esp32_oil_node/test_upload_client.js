const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function upload(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  try {
    const res = await axios.post('http://localhost:8081/upload-wallpaper', form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 10000
    });
    console.log('Upload', filePath, '=>', res.status, JSON.stringify(res.data));
  } catch (err) {
    if (err.response) {
      console.log('Upload', filePath, '=>', err.response.status, err.response.data);
    } else {
      console.log('Upload', filePath, '=> error', err.message);
    }
  }
}

(async () => {
  const base = __dirname;
  await upload(base + '/small.jpg');
  await upload(base + '/large.jpg');
  try {
    const info = await axios.get('http://localhost:8081/wallpaper-info', { timeout: 5000 });
    console.log('/wallpaper-info =>', JSON.stringify(info.data));
  } catch (e) {
    console.log('info error', e.message);
  }
})();
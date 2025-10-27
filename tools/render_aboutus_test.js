import fs from 'fs';
import ejs from 'ejs';

const tplPath = 'c:/Users/1/OneDrive/Desktop/SIA/src/views/customer/aboutus.ejs';
const tpl = fs.readFileSync(tplPath, 'utf8');

const data = {
  cmsAbout: {
    about_title: 'Test About',
    about_subtitle: 'Subtitle',
    features: ['Fast', 'Reliable'],
    why_title: 'Why Test',
    why_body: 'Because we test.',
    key_features: ['KF1', 'KF2'],
    about_image_url: '/image/home1.png',
    team: [
      { name: 'Alice', role: 'CEO', image_url: '/image/alice.png' },
      { name: 'Bob', role: 'CTO', image_url: null }
    ]
  }
};

try {
  const html = ejs.render(tpl, data);
  console.log('RENDER_OK');
} catch (err) {
  console.error('RENDER_ERROR');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}

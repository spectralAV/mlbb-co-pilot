import { syncOfficialData } from '../providers/mlbb/syncOfficialData.js';

const token = process.env.MLBB_GMS_AUTHORIZATION;
if (!token) {
  console.error('Set MLBB_GMS_AUTHORIZATION first.');
  process.exit(1);
}

syncOfficialData({ authorization: token }).then((result) => {
  console.log(JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

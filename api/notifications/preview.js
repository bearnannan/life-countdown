import { handleCloudApi } from '../../server/cloud-api.js';

export default function handler(req, res) {
  return handleCloudApi(req, res, 'notifications/preview');
}

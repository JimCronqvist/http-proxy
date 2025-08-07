import { env, realClientIP } from '../utils.mjs';

export const onRequest = async (req, res) => {
  req.log.info(`Request:  ${req.method} ${req.url} [${realClientIP(req)}]`);
}
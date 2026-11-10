// Минимальный SMTP-клиент (TLS на 465 или STARTTLS). Настраивается только через переменные окружения.
import tls from 'node:tls';
import net from 'node:net';

export const mailConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);

export function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!mailConfigured()) return Promise.reject(new Error('SMTP не настроен'));
  const host = process.env.SMTP_HOST as string;
  const port = Number(process.env.SMTP_PORT || 465);
  const from = process.env.SMTP_FROM as string;
  return new Promise((resolve, reject) => {
    let sock: any = port === 465 ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '';
    let waiter: ((line: string) => void) | null = null;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('SMTP timeout')); }, 20_000);
    const attach = (s: any) => s.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const l = lines[i];
        if (/^\d{3} /.test(l) && waiter) { const w = waiter; waiter = null; buf = lines.slice(i + 1).join('\r\n'); w(l); return; }
      }
    });
    attach(sock);
    sock.on('error', (e: any) => { clearTimeout(timer); reject(e); });
    const read = () => new Promise<string>((r) => { waiter = r; });
    const cmd = async (c: string | null, ok: string) => {
      const p = read();
      if (c !== null) sock.write(c + '\r\n');
      const line = await p;
      if (!line.startsWith(ok)) throw new Error('SMTP: ' + line);
      return line;
    };
    (async () => {
      await cmd(null, '220');
      await cmd('EHLO burger-skin', '250');
      if (port !== 465) {
        await cmd('STARTTLS', '220');
        sock.removeAllListeners('data');
        sock = tls.connect({ socket: sock, servername: host });
        attach(sock);
        await new Promise((r) => sock.once('secureConnect', r));
        await cmd('EHLO burger-skin', '250');
      }
      await cmd('AUTH LOGIN', '334');
      await cmd(Buffer.from(process.env.SMTP_USER as string).toString('base64'), '334');
      await cmd(Buffer.from(process.env.SMTP_PASS as string).toString('base64'), '235');
      const addr = (s: string) => (/<([^>]+)>/.exec(s) || [null, s])[1];
      await cmd(`MAIL FROM:<${addr(from)}>`, '250');
      await cmd(`RCPT TO:<${to}>`, '25');
      await cmd('DATA', '354');
      const body = [`From: ${from}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, 'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n')].join('\r\n');
      await cmd(body + '\r\n.', '250');
      sock.write('QUIT\r\n');
      sock.end();
      clearTimeout(timer);
      resolve();
    })().catch((e) => { clearTimeout(timer); sock.destroy(); reject(e); });
  });
}

# SendGrid

Copies a site's subscribers to a list in the site's own SendGrid account, and sends the mail its readers get (the subscribe confirmation, sign-in links and each issue) from that account. Pick SendGrid under **Subscribers › Newsletter service** in moss, make an API key in SendGrid as the three steps there say, and paste it. The site's `.moss/config.toml` then reads:

```toml
[channels.email]
service = "sendgrid"
```

The pasted key is used once and never stored: moss's server makes a narrower key from it, and deletes the pasted one when it is named `moss`. The plugin holds no code; the SendGrid side runs on moss's server.

## Network access

None. The plugin makes no requests; moss's server calls `api.sendgrid.com` with the key.

# niax-api

In order to being able to create a server backup on [nodemon](https://github.com/remy/nodemon) restart (by listening to `SIGUSR2` signal) you need to run the api on Linux, for example using [WSL](https://learn.microsoft.com/en-us/windows/wsl/).

SSL certificate (for development) is created and can only be used with [mkcert](https://github.com/FiloSottile/mkcert):

```
$ mkcert -install
$ mkcert localhost
```

I could not get mkcert working on Windows (even with _both_ Windows api and [client](https://github.com/striderhobbit/niax-cli)), so client app needs to be served on WSL too; and then even your web browser accessing the client app needs to be run on WSL.

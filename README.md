# Bilibili 解析工具

由[@Yamada-Ryo4/bili-resolver](https://github.com/Yamada-Ryo4/bili-resolver) 二改而来

原本为cloudflare worker运行时，后改为原生Node.js运行时，无需第三方依赖，可直接运行

支持解析 BV 号、b23.tv 短链及完整 URL，返回高清直链并可直接播放。

## 运行

```bash
pnpm start
```
or
```bash
npm start
```

默认端口：3000

## 使用

打开浏览器访问：

```
http://localhost:3000
```

接口示例：

```
http://localhost:3000/api/any?text=BV1xx4y1xx&qn=80
```

感谢[@Yamada-Ryo4/bili-resolver](https://github.com/Yamada-Ryo4/bili-resolver) 提供的解析工具

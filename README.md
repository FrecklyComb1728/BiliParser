# Bilibili 解析工具

由[@Yamada-Ryo4/bili-resolver](https://github.com/Yamada-Ryo4/bili-resolver) 二改而来

原本为cloudflare worker运行时，后改为原生Node.js运行时，无需第三方依赖，可直接运行（也可使用vercel部署）

支持解析 BV 号、b23.tv 短链及完整 URL，返回高清直链并可直接播放。

## 运行

```bash
pnpm start
```
or
```bash
npm start
```

默认端口：4836

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/FrecklyComb1728/BiliParser)

~~不是不适配EO Pages，EO太他妈傻逼了，我没招了~~

如果是vercel记得去设置函数区域为HongKong ~~(不设置其实也可以)~~
https://vercel.com/[You-Username]/bili-parser/settings/functions#function-region
## 使用

打开浏览器访问：

```
http://localhost:4836
```

接口示例：

```
http://localhost:4836/api/any?text=BV1xx4y1xx&qn=80
```

感谢[@Yamada-Ryo4/bili-resolver](https://github.com/Yamada-Ryo4/bili-resolver) 提供的解析工具

import { DB, genId } from './db.js';
import { parseEntry }  from './parse.js';

export function seedIfEmpty() {
  if (DB.entries.length) return;

  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  const ts  = (day, hour = 10) => new Date(y, mo, day, hour, 0).toISOString();

  const seeds = [
    // ── 收入
    { raw:'工资 12000',                                         tags:[], places:[], price:12000, type:'income',  day:1,  hour:9  },
    { raw:'freelance收入 3000 @微信转账',                       tags:[], places:['微信转账'],    price:3000,  type:'income',  day:15, hour:11 },

    // ── 普通支出 + @地点
    { raw:'午饭 32 @公司楼下/快餐',  tags:[], places:['公司楼下/快餐'],  price:32,   type:'expense', day:2,  hour:12 },

    // ── # 商品 + @ 地点 + * 评分（比价场景）
    { raw:'#咖啡/拿铁 @星巴克/国贸店 38 *8/10',                tags:['咖啡/拿铁'], places:['星巴克/国贸店'], price:38,   type:'expense', day:3,  hour:10 },
    { raw:'#咖啡/拿铁 @瑞幸/朝阳门 18 *6/10 太酸了',           tags:['咖啡/拿铁'], places:['瑞幸/朝阳门'],   price:18,   type:'expense', day:5,  hour:9  },
    { raw:'#咖啡/拿铁 @星巴克/国贸店 38 *9/10 今天做得好',      tags:['咖啡/拿铁'], places:['星巴克/国贸店'], price:38,   type:'expense', day:8,  hour:11 },

    // ── % 进度：读书（区间格式）
    { raw:'#书/原子习惯 %1/1-200 开始读',   tags:['书/原子习惯'], places:[], price:null, type:'expense', day:4,  hour:21 },
    { raw:'#书/原子习惯 %68/1-200',          tags:['书/原子习惯'], places:[], price:null, type:'expense', day:7,  hour:22 },
    { raw:'#书/原子习惯 %200/1-200 读完了 *9/10', tags:['书/原子习惯'], places:[], price:null, type:'expense', day:10, hour:20 },

    // ── % 进度：追剧（分数格式）
    { raw:'#剧/黑镜 %3/6 @Netflix',                  tags:['剧/黑镜'], places:['Netflix'], price:null, type:'expense', day:6,  hour:22 },
    { raw:'#剧/黑镜 %6/6 @Netflix 结局一般 *6.5/10', tags:['剧/黑镜'], places:['Netflix'], price:null, type:'expense', day:9,  hour:23 },

    // ── % 进度：百分比格式
    { raw:'#健身/深蹲 %65 今天65%完成量', tags:['健身/深蹲'], places:[], price:null, type:'expense', day:11, hour:19 },

    // ── 种草（无价格）
    { raw:'#耳机/索尼WH1000XM5 @京东 种草已久', tags:['耳机/索尼WH1000XM5'], places:['京东'], price:null, type:'expense', isWishlist:true, day:5, hour:14 },
    // ── 种草（有参考价格）
    { raw:'#机械键盘/HHKB @淘宝 1500',          tags:['机械键盘/HHKB'],       places:['淘宝'], price:1500, type:'expense', isWishlist:true, day:8, hour:16 },

    // ── 已购种草商品（同标签出现两次 → 比价）
    { raw:'#耳机/索尼WH1000XM5 @京东 2299 到手了！*9/10', tags:['耳机/索尼WH1000XM5'], places:['京东'], price:2299, type:'expense', day:12, hour:15 },

    // ── 纯备注
    { raw:'今天把订阅都整理了一遍', tags:[], places:[], price:null, type:'expense', day:16, hour:10 },

    // ── 多标签多地点
    { raw:'#零食/薯片 #零食/坚果 @超市/盒马 45', tags:['零食/薯片','零食/坚果'], places:['超市/盒马'], price:45, type:'expense', day:18, hour:18 },
  ];

  DB.entries = seeds.map(s => {
    const p = parseEntry(s.raw);
    return {
      id:         genId(),
      timestamp:  ts(s.day, s.hour),
      raw:        s.raw,
      price:      s.price,
      tags:       s.tags,
      places:     s.places,
      ratings:    p.ratings,
      progresses: p.progresses,
      note:       p.note,
      type:       s.type,
      isWishlist: s.isWishlist || false,
    };
  });

  DB.tags   = [...new Set(seeds.flatMap(s => s.tags))  ].map(path => ({ id: genId(), path }));
  DB.places = [...new Set(seeds.flatMap(s => s.places))].map(path => ({ id: genId(), path }));
}

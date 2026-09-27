"""生成 www/fonts/pinyin.js：常用汉字 → 拼音（不带声调），用于把中文名字写成问候语里的拼音。

数据来源：
- 系统自带的 Perl Unicode::Collate::CJK::Pinyin：按“音节+声调”分好组、排好序的汉字，但没有标出读音；
- 下面这张手写的常用字读音表：给这些组“认领”读音。和已知字在同一组的字读音一定相同。
"""
import os, re, json

HERE = os.path.dirname(os.path.abspath(__file__))
PM = '/usr/share/perl/5.38.2/Unicode/Collate/CJK/Pinyin.pm'

KNOWN = """
a:阿啊 ai:爱哀挨埃癌矮艾碍唉 an:安按暗岸案俺氨鞍庵 ang:昂肮 ao:奥澳傲熬袄凹敖翱
ba:八巴把爸吧拔霸坝芭扒疤捌叭跋 bai:白百摆败拜佰掰 ban:办半班般板版伴扮搬斑颁瓣拌绊 bang:帮邦棒榜膀绑傍谤镑
bao:包保报宝抱饱暴爆豹鲍胞苞褒堡雹 bei:北被备背倍杯悲贝辈碑卑惫 ben:本奔笨苯 beng:崩蹦泵绷甭
bi:比必笔闭毕币壁避鼻彼碧逼毙弊蔽臂璧弼 bian:边变遍编辩鞭贬扁卞辨辫 biao:表标彪膘镖飙 bie:别憋鳖
bin:宾滨彬斌缤濒鬓 bing:兵冰病并饼丙柄秉炳 bo:波博播伯拨驳泊勃玻铂搏脖舶渤 bu:不部步布补捕卜怖埠簿哺
ca:擦 cai:才材菜财采彩裁猜蔡 can:残惨灿餐蚕璨 cang:仓苍舱沧 cao:草操曹槽糙 ce:测策侧册厕 cen:岑 ceng:层蹭
cha:茶插察叉岔刹诧 chai:柴拆豺 chan:产缠馋禅蝉颤铲阐婵 chang:常场厂唱畅昌尝肠偿敞倡猖 chao:超潮炒吵抄巢钞晁
che:车彻撤扯澈 chen:陈晨沉尘臣趁衬辰琛宸忱 cheng:成城程称承诚呈撑澄橙惩骋丞 chi:吃持池迟尺齿赤翅耻斥驰痴弛炽
chong:冲虫崇宠充 chou:抽愁丑臭筹酬绸稠 chu:出初除础储触楚厨锄雏 chuan:船川穿串喘 chuang:创窗床闯疮
chui:吹垂锤炊 chun:春纯唇醇淳椿 chuo:戳绰 ci:次此词辞刺瓷磁雌赐慈 cong:从丛聪葱匆琮淙 cou:凑 cu:粗促醋簇
cuan:窜篡 cui:催脆翠崔摧粹萃璀 cun:村存寸 cuo:错措挫搓 da:大达打答搭 dai:带代待戴袋贷呆怠黛岱
dan:但担蛋淡胆旦丹诞郸 dang:当党挡档荡 dao:到道导倒刀岛盗稻蹈悼 de:得德 deng:等灯登邓凳瞪
di:地第低底敌帝弟递滴迪笛堤抵蒂娣狄 dian:点电店典殿垫颠甸奠佃靛 diao:掉吊钓雕刁 die:跌爹叠蝶碟迭
ding:定顶丁订钉鼎盯 diu:丢 dong:东动冬懂洞董栋冻 dou:斗豆抖逗陡窦 du:度读独毒堵督渡杜肚赌镀笃
duan:段短断端锻缎 dui:对队堆兑 dun:顿吨蹲盾敦墩钝 duo:多夺朵躲舵堕惰铎 e:额恶饿鹅俄蛾娥峨鄂 en:恩
er:二而儿耳尔 fa:发法罚乏伐阀筏 fan:反饭翻番犯凡范返烦繁泛樊帆 fang:方放房防访仿芳纺坊妨舫
fei:非飞费肥废肺菲匪沸妃斐霏 fen:分份粉奋愤纷坟芬焚汾 feng:风丰封峰锋疯奉逢缝枫凤冯蜂 fo:佛 fou:否
fu:夫府复服副福负父付富附浮扶符腐赴妇伏肤抚辅赋傅芙甫涪馥 gai:改该概钙溉 gan:感干赶敢甘肝杆竿柑赣淦
gang:刚钢港岗纲缸杠罡 gao:高告搞稿糕膏皋 ge:个各歌格哥割革隔阁搁戈鸽 gei:给 gen:根跟 geng:更耕庚耿梗
gong:工公共功攻供宫贡恭弓巩拱龚 gou:够构狗沟购勾钩苟垢 gu:古故顾固鼓骨谷股孤姑辜菇雇咕 gua:挂瓜刮寡
guai:怪乖拐 guan:关观管官馆惯冠贯灌罐 guang:光广逛 gui:规归贵鬼柜轨桂龟瑰硅 gun:滚棍 guo:国过果锅郭裹
ha:哈 hai:海害孩亥骇 han:含汉寒喊汗韩涵旱罕翰函晗憨 hang:航杭 hao:好号毫豪耗浩郝皓昊灏
he:和合河何喝贺荷核赫鹤盒禾 hei:嘿 hen:很恨狠痕 heng:横衡恒哼亨 hong:红洪宏虹鸿哄烘弘泓 hou:后候厚猴侯吼
hu:湖户护互乎胡虎呼忽壶糊狐弧浒沪葫瑚 hua:化话花华画滑划哗 huai:坏怀淮槐 huan:换环欢缓患唤焕幻桓寰
huang:黄皇荒慌晃谎凰煌璜 hui:回灰挥辉汇绘惠慧毁悔恢徽卉晖 hun:婚混昏魂浑 huo:或活火获货伙祸惑霍豁
ji:机几及级极积基集记计济技即急击激继既际季纪迹鸡吉籍寄疾辑姬冀骥 jia:家加价假架甲佳夹嘉驾嫁稼贾
jian:间见建件简健检坚减剑渐尖监肩艰兼剪荐鉴箭溅俭践舰 jiang:江讲奖蒋疆僵酱姜浆 jiao:教交较叫角脚焦骄郊胶椒娇礁浇搅缴
jie:结接节界街借姐介阶届洁杰劫戒揭捷截皆婕 jin:进今金近尽紧仅禁劲津锦晋浸谨巾筋靳瑾
jing:经精京境静景竞警井敬镜净惊晶径颈靖菁璟婧 jiong:窘炯迥 jiu:就九旧究酒久救纠揪玖灸
ju:局举具据句巨居聚剧拒菊橘俱鞠矩炬 juan:卷捐绢娟涓鹃 jue:决觉绝掘爵诀倔珏 jun:军均君俊菌峻骏钧郡竣
ka:卡咖 kai:开凯慨楷铠 kan:看刊砍堪坎侃 kang:康抗扛炕慷 kao:考靠烤拷 ke:可科克客课刻渴壳颗柯棵磕苛
ken:肯恳垦啃 keng:坑 kong:空控孔恐 kou:口扣寇叩 ku:苦哭库酷裤枯窟 kua:夸跨垮挎 kuai:快块筷 kuan:宽款
kuang:况矿狂框旷匡筐 kui:亏奎愧溃葵魁馈 kun:困昆坤 kuo:扩括阔廓 la:拉啦辣蜡喇 lai:来莱赖睐
lan:兰蓝栏拦烂懒览篮澜岚 lang:浪狼郎朗廊琅 lao:老劳牢捞姥涝 le:勒 lei:类泪累雷蕾磊垒 leng:冷楞愣
li:力理利立里李历例离丽礼黎励厉粒梨莉璃俐隶栗 lian:连联练脸恋莲廉炼帘怜涟琏 liang:两量良亮凉梁粮谅辆
liao:料疗聊辽廖寥 lie:列烈裂猎劣 lin:林临邻淋琳霖麟磷鳞 ling:领令另零灵龄玲岭凌铃陵菱羚
liu:流六留刘柳溜硫瘤浏 long:龙隆笼聋拢垄珑 lou:楼漏搂娄 lu:路陆录鹿炉卢鲁芦碌禄璐 lv:绿律旅虑吕铝履驴侣
luan:乱卵峦 lve:略掠 lun:论轮伦仑 luo:落罗洛络骆逻螺锣萝裸 ma:马妈吗骂麻码玛 mai:买卖麦迈埋
man:满慢漫曼蛮瞒馒蔓 mang:忙盲茫芒莽 mao:毛冒猫貌帽茂矛贸卯 mei:没美每妹梅眉煤媒霉枚玫 men:门们闷
meng:梦猛蒙孟盟萌 mi:米密迷蜜弥觅眯谜 mian:面免棉眠绵勉冕 miao:秒描苗庙妙瞄渺淼 mie:灭蔑 min:民敏闽珉岷
ming:名明命鸣铭冥茗 mo:末默磨莫摸墨膜魔陌沫 mou:某谋牟 mu:目木母幕墓牧慕穆沐睦暮 na:拿哪纳娜
nai:乃奶耐奈 nan:南难男楠 nang:囊 nao:脑闹恼挠 ne:呢 nei:内 nen:嫩 neng:能 ni:你尼泥拟逆倪妮霓
nian:年念碾 niang:娘酿 niao:鸟尿 nie:聂捏涅 nin:您 ning:宁凝柠拧 niu:牛纽扭钮妞 nong:农浓弄 nu:努怒奴
nv:女 nuan:暖 nve:虐 nuo:诺挪懦 ou:欧偶呕鸥藕 pa:怕爬帕趴 pai:派排拍牌徘 pan:盘判盼攀潘叛 pang:旁胖庞
pao:跑泡炮抛袍 pei:配培陪赔佩裴沛 pen:盆喷 peng:朋碰鹏彭棚蓬篷澎 pi:皮批披疲脾匹屁譬 pian:片偏篇骗
piao:票飘瓢 pie:撇瞥 pin:品拼频贫聘 ping:平评瓶凭萍屏坪苹 po:破坡泼迫婆颇魄 pou:剖 pu:普铺扑谱浦仆葡蒲圃
qi:起其期气七器齐企汽骑旗弃妻启棋祈琪琦淇麒 qia:恰洽掐 qian:前钱千签欠浅迁潜谦牵铅倩 qiang:抢墙枪腔蔷
qiao:桥巧敲乔瞧悄侨翘俏 qie:切且窃怯 qin:亲勤琴秦侵禽钦芹沁 qing:情清请青轻庆晴倾卿擎 qiong:穷琼
qiu:求球秋丘邱囚 qu:去取趣渠驱屈躯 quan:全权劝圈泉拳犬券诠 que:却确缺雀鹊 qun:群裙 ran:然燃染冉
rang:让嚷壤 rao:绕扰饶 re:热惹 ren:人认仁忍刃 reng:仍扔 ri:日 rong:容荣融溶蓉绒熔戎 rou:肉柔揉
ru:如入乳辱儒茹汝 ruan:软阮 rui:瑞锐睿蕊芮 run:润闰 ruo:若弱 sa:撒洒萨 sai:赛腮 san:三散伞 sang:桑嗓
sao:扫嫂骚 se:色瑟涩 sen:森 seng:僧 sha:沙杀傻纱砂鲨 shai:晒筛 shan:山善闪衫扇陕杉珊擅
shang:上商伤尚赏裳 shao:少绍烧稍勺哨韶邵 she:社设射舍涉摄蛇佘 shen:身深神申甚伸审肾慎绅婶莘
sheng:生声胜升圣盛绳剩笙晟 shi:是时十事实使世市识始式史师石施试势示失士视适食室诗湿拾狮氏
shou:手受收首守授售兽寿瘦 shu:书树术输述熟叔舒殊鼠蜀淑梳疏抒枢 shua:刷耍 shuai:帅摔衰甩 shuan:拴栓
shuang:双爽霜 shui:水谁睡税 shun:顺瞬舜 shuo:说硕朔 si:四思死司私斯丝似寺饲撕嗣 song:送松宋颂诵耸
sou:搜艘嗽 su:速素苏诉塑俗酥肃粟 suan:算酸蒜 sui:随岁虽碎遂穗隋髓 sun:孙损笋 suo:所索锁缩梭
ta:他她它塔踏 tai:太台态泰抬胎汰 tan:谈探坦叹摊滩坛潭碳谭 tang:堂唐糖汤躺趟塘棠 tao:套讨逃桃陶淘涛滔萄
te:特 teng:疼腾藤 ti:体提题替梯踢蹄 tian:天田甜添填恬 tiao:条跳挑 tie:铁贴 ting:听停庭挺亭廷婷
tong:同通统痛童铜桶筒彤桐瞳 tou:头投透偷 tu:图土突途徒涂吐兔屠 tuan:团 tui:推退腿 tun:吞屯 tuo:脱托拖妥拓驼
wa:挖瓦娃蛙 wai:外歪 wan:万完晚玩湾碗婉宛挽丸皖琬 wang:王往望网忘旺汪亡枉
wei:为位未委围卫维味威微伟尾危违魏韦唯慰薇蔚纬玮 wen:问文闻温稳吻纹雯 weng:翁 wo:我握卧窝沃
wu:无五物务午武吴舞误屋乌污伍悟雾勿巫 xi:西细习喜息希席析吸洗戏惜锡溪夕熙曦
xia:下夏吓峡虾霞瞎侠辖 xian:先现线显县限险鲜献闲仙贤掀弦纤咸衔宪娴 xiang:想向相象香乡响项详祥享湘翔
xiao:小笑校效消晓销肖孝萧潇啸筱 xie:些写谢协鞋斜携泄卸蟹谐 xin:新心信辛欣薪馨鑫芯昕
xing:性形星兴型姓幸醒刑杏邢 xiong:雄兄熊胸凶 xiu:修秀休袖绣羞朽 xu:需许续须序虚徐绪旭叙蓄婿栩
xuan:选宣悬旋玄轩萱暄瑄 xue:学雪血穴薛靴 xun:讯寻训迅询旬巡循熏逊勋荀 ya:压呀牙亚雅鸭芽崖涯
yan:言眼严研验烟沿延演颜盐燕岩焰艳炎宴砚彦妍晏 yang:样阳洋养羊央扬仰杨氧痒漾 yao:要药摇腰遥咬邀耀谣姚瑶尧
ye:也业夜叶页野爷液冶椰耶 yi:一以已意义议易医依衣移亿艺益异遗疑仪宜姨忆亦译谊毅翼逸怡奕懿
yin:因音引银印饮阴隐殷寅茵吟 ying:应英影营迎硬映赢樱盈莹颖鹰婴瑛滢 yo:哟 yong:用永勇拥涌泳庸雍咏
you:有由又友游油右优幽犹邮尤佑悠柚 yu:于与语育遇预余雨鱼玉宇域羽愉欲誉浴寓渔郁裕豫御喻瑜煜钰昱毓
yuan:元员原园远源院愿圆援缘袁怨苑媛渊沅 yue:月越约阅跃悦粤岳 yun:云运允韵孕晕匀蕴芸昀 za:杂砸
zai:在再载灾栽宰 zan:赞咱暂 zang:脏葬赃 zao:早造遭糟灶燥枣澡 ze:则责择泽 zei:贼 zen:怎 zeng:增赠憎
zha:炸扎渣眨榨诈 zhai:摘窄债寨宅斋 zhan:站战展占沾斩盏湛詹 zhang:张章掌涨丈帐障彰樟璋
zhao:找照招赵兆昭沼 zhe:这者折哲浙遮蔗 zhen:真针阵镇震振诊珍枕贞侦祯臻甄 zheng:正政整证争征郑挣睁蒸症铮峥
zhi:之只知至制直治指支志质致织植纸止值职智执置枝汁芝稚旨挚芷 zhong:中种众终钟忠肿仲衷
zhou:周州洲舟皱骤轴宙咒 zhu:主住注助著竹朱珠猪诸逐烛煮筑祝铸驻柱株蛛 zhua:抓爪 zhuan:专转赚砖撰
zhuang:装状庄壮撞妆桩 zhui:追坠缀锥 zhun:准 zhuo:桌卓捉浊啄灼琢茁 zi:子自字资紫姿滋仔梓籽
zong:总宗综纵棕踪鬃 zou:走奏揍邹 zu:组族足祖阻租卒 zuan:钻 zui:最罪嘴醉 zun:尊遵 zuo:作做坐左座昨佐
"""
# 名字里常见、但有多个读音的字：取名字里的读法
NAME_READ = {'长': 'chang', '传': 'chuan', '行': 'xing', '重': 'zhong', '朝': 'zhao', '藏': 'zang', '曾': 'zeng', '查': 'cha',
             '露': 'lu', '柏': 'bai', '茜': 'qian', '强': 'qiang', '单': 'dan', '朴': 'pu', '区': 'qu', '会': 'hui', '奇': 'qi',
             '乐': 'le', '省': 'xing', '降': 'jiang', '薄': 'bo', '模': 'mo', '乘': 'cheng', '系': 'xi', '参': 'shen', '差': 'cha',
             '都': 'du', '还': 'huan', '了': 'liao', '调': 'tiao', '着': 'zhuo', '率': 'shuai', '仇': 'chou', '解': 'jie', '盖': 'gai',
             '覃': 'tan', '缪': 'miu', '尉': 'wei', '翟': 'di', '召': 'zhao', '华': 'hua', '沈': 'shen', '宁': 'ning', '燕': 'yan',
             '任': 'ren', '曲': 'qu', '纪': 'ji', '秘': 'mi', '员': 'yuan', '万': 'wan', '黑': 'hei', '那': 'na', '便': 'bian',
             '数': 'shu', '属': 'shu', '弹': 'dan', '冲': 'chong', '石': 'shi', '晟': 'sheng', '娜': 'na', '祭': 'ji', '莘': 'shen'}
# 作为姓时的读法（只在名字第一个字时用）
SURNAME = {'单': 'shan', '曾': 'zeng', '解': 'xie', '仇': 'qiu', '区': 'ou', '查': 'zha', '朴': 'piao', '盖': 'ge', '覃': 'qin',
           '缪': 'miao', '乐': 'yue', '尉': 'yu', '翟': 'zhai', '召': 'shao', '沈': 'shen', '任': 'ren', '曲': 'qu', '纪': 'ji',
           '秘': 'bi', '员': 'yun', '黑': 'he', '那': 'na', '万': 'wan', '长': 'chang', '重': 'chong', '藏': 'zang', '朝': 'chao',
           '种': 'chong', '繁': 'po', '句': 'gou', '过': 'guo', '能': 'nai', '贲': 'ben', '莘': 'shen', '祭': 'zhai', '华': 'hua'}
COMPOUND = {'欧阳': 'ouyang', '司马': 'sima', '诸葛': 'zhuge', '上官': 'shangguan', '东方': 'dongfang', '皇甫': 'huangfu',
            '令狐': 'linghu', '慕容': 'murong', '司徒': 'situ', '公孙': 'gongsun', '夏侯': 'xiahou', '尉迟': 'yuchi', '长孙': 'zhangsun',
            '宇文': 'yuwen', '端木': 'duanmu', '独孤': 'dugu', '南宫': 'nangong', '西门': 'ximen', '轩辕': 'xuanyuan', '司空': 'sikong',
            '呼延': 'huyan', '澹台': 'tantai', '公冶': 'gongye', '太史': 'taishi', '申屠': 'shentu', '万俟': 'moqi', '闻人': 'wenren'}

known = {}
for tok in KNOWN.split():
    syl, chars = tok.split(':')
    for ch in chars:
        if ch in known and known[ch] != syl:
            raise SystemExit(f'conflict {ch}: {known[ch]} vs {syl}')
        known[ch] = syl

# 读出 Perl 数据：一行最多 10 个字，满 10 个说明同一组还在继续；每行都属于唯一一组
from collections import Counter
lines, cont = [], []
for line in open(PM, encoding='utf-8').read().split('__DATA__')[1].split('__END__')[0].splitlines():
    toks = line.split()
    if not toks:
        continue
    items = [chr(int(t, 16)) for t in toks if '-' not in t]
    if items:
        lines.append(items)
        cont.append(len(toks) == 10)
count = Counter(c for L in lines for c in L)
label = []
for L in lines:
    votes = Counter(known[c] for c in L if c in known and count[c] == 1)
    label.append(votes.most_common(1)[0][0] if votes else None)
# 同一组（折行相连）里没认领到的行：跟着同组的行走
chunks, cur = [], []
for i in range(len(lines)):
    cur.append(i)
    if not cont[i]:
        chunks.append(cur); cur = []
if cur:
    chunks.append(cur)
for ch in chunks:
    for k, i in enumerate(ch):
        if label[i]:
            continue
        prev = next((label[j] for j in reversed(ch[:k]) if label[j]), None)
        nxt = next((label[j] for j in ch[k + 1:] if label[j]), None)
        label[i] = prev or nxt
# 还没认领的：前后最近的认领相同就归它，否则跟前面
out = {}
n_exact = n_guess = 0
for i, L in enumerate(lines):
    syl = label[i]
    if not syl:
        p = next((label[j] for j in range(i - 1, -1, -1) if label[j]), None)
        q = next((label[j] for j in range(i + 1, len(lines)) if label[j]), None)
        syl = p if p == q else (p or q)
        n_guess += len(L)
    else:
        n_exact += len(L)
    for c in L:
        if '\u4e00' <= c <= '\u9fff':
            out.setdefault(c, syl)
for ch_, syl in known.items():
    out[ch_] = syl
for ch_, syl in NAME_READ.items():
    out[ch_] = syl

# 压缩：按音节分组存成字符串
by = {}
for ch, syl in out.items():
    by.setdefault(syl, []).append(ch)
data = {k: ''.join(sorted(v)) for k, v in sorted(by.items())}
js = ('window.PINYIN_DATA=' + json.dumps({'s': data, 'sur': SURNAME, 'cmp': COMPOUND}, ensure_ascii=False, separators=(',', ':')) + ';')
p = os.path.join(HERE, 'www', 'fonts', 'pinyin.js')
open(p, 'w', encoding='utf-8').write(js)
print('chars', len(out), 'exact-group', n_exact, 'guessed', n_guess, 'size', len(js.encode()))

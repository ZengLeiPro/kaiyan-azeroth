import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export const UNKNOWN_REGION_VALUE = '未知';
const UNKNOWN_REGION_OPTION = { code: 'unknown', name: UNKNOWN_REGION_VALUE };

// 中国省市区数据
const addressData = {
  provinces: [
    { code: '110000', name: '北京市' },
    { code: '120000', name: '天津市' },
    { code: '130000', name: '河北省' },
    { code: '140000', name: '山西省' },
    { code: '150000', name: '内蒙古自治区' },
    { code: '210000', name: '辽宁省' },
    { code: '220000', name: '吉林省' },
    { code: '230000', name: '黑龙江省' },
    { code: '310000', name: '上海市' },
    { code: '320000', name: '江苏省' },
    { code: '330000', name: '浙江省' },
    { code: '340000', name: '安徽省' },
    { code: '350000', name: '福建省' },
    { code: '360000', name: '江西省' },
    { code: '370000', name: '山东省' },
    { code: '410000', name: '河南省' },
    { code: '420000', name: '湖北省' },
    { code: '430000', name: '湖南省' },
    { code: '440000', name: '广东省' },
    { code: '450000', name: '广西壮族自治区' },
    { code: '460000', name: '海南省' },
    { code: '500000', name: '重庆市' },
    { code: '510000', name: '四川省' },
    { code: '520000', name: '贵州省' },
    { code: '530000', name: '云南省' },
    { code: '540000', name: '西藏自治区' },
    { code: '610000', name: '陕西省' },
    { code: '620000', name: '甘肃省' },
    { code: '630000', name: '青海省' },
    { code: '640000', name: '宁夏回族自治区' },
    { code: '650000', name: '新疆维吾尔自治区' },
  ],
  cities: {
    // 北京市
    '110000': [{ code: '110100', name: '北京市' }],
    // 天津市
    '120000': [{ code: '120100', name: '天津市' }],
    // 河北省
    '130000': [
      { code: '130100', name: '石家庄市' },
      { code: '130200', name: '唐山市' },
      { code: '130300', name: '秦皇岛市' },
      { code: '130400', name: '邯郸市' },
      { code: '130500', name: '邢台市' },
      { code: '130600', name: '保定市' },
      { code: '130700', name: '张家口市' },
      { code: '130800', name: '承德市' },
      { code: '130900', name: '沧州市' },
      { code: '131000', name: '廊坊市' },
      { code: '131100', name: '衡水市' },
    ],
    // 山西省
    '140000': [
      { code: '140100', name: '太原市' },
      { code: '140200', name: '大同市' },
      { code: '140300', name: '阳泉市' },
      { code: '140400', name: '长治市' },
      { code: '140500', name: '晋城市' },
      { code: '140600', name: '朔州市' },
      { code: '140700', name: '晋中市' },
      { code: '140800', name: '运城市' },
      { code: '140900', name: '忻州市' },
      { code: '141000', name: '临汾市' },
      { code: '141100', name: '吕梁市' },
    ],
    // 内蒙古自治区
    '150000': [
      { code: '150100', name: '呼和浩特市' },
      { code: '150200', name: '包头市' },
      { code: '150300', name: '乌海市' },
      { code: '150400', name: '赤峰市' },
      { code: '150500', name: '通辽市' },
      { code: '150600', name: '鄂尔多斯市' },
      { code: '150700', name: '呼伦贝尔市' },
      { code: '150800', name: '巴彦淖尔市' },
      { code: '150900', name: '乌兰察布市' },
    ],
    // 辽宁省
    '210000': [
      { code: '210100', name: '沈阳市' },
      { code: '210200', name: '大连市' },
      { code: '210300', name: '鞍山市' },
      { code: '210400', name: '抚顺市' },
      { code: '210500', name: '本溪市' },
      { code: '210600', name: '丹东市' },
      { code: '210700', name: '锦州市' },
      { code: '210800', name: '营口市' },
      { code: '210900', name: '阜新市' },
      { code: '211000', name: '辽阳市' },
      { code: '211100', name: '盘锦市' },
      { code: '211200', name: '铁岭市' },
      { code: '211300', name: '朝阳市' },
      { code: '211400', name: '葫芦岛市' },
    ],
    // 吉林省
    '220000': [
      { code: '220100', name: '长春市' },
      { code: '220200', name: '吉林市' },
      { code: '220300', name: '四平市' },
      { code: '220400', name: '辽源市' },
      { code: '220500', name: '通化市' },
      { code: '220600', name: '白山市' },
      { code: '220700', name: '松原市' },
      { code: '220800', name: '白城市' },
    ],
    // 黑龙江省
    '230000': [
      { code: '230100', name: '哈尔滨市' },
      { code: '230200', name: '齐齐哈尔市' },
      { code: '230300', name: '鸡西市' },
      { code: '230400', name: '鹤岗市' },
      { code: '230500', name: '双鸭山市' },
      { code: '230600', name: '大庆市' },
      { code: '230700', name: '伊春市' },
      { code: '230800', name: '佳木斯市' },
      { code: '230900', name: '七台河市' },
      { code: '231000', name: '牡丹江市' },
      { code: '231100', name: '黑河市' },
      { code: '231200', name: '绥化市' },
    ],
    // 上海市
    '310000': [{ code: '310100', name: '上海市' }],
    // 江苏省
    '320000': [
      { code: '320100', name: '南京市' },
      { code: '320200', name: '无锡市' },
      { code: '320300', name: '徐州市' },
      { code: '320400', name: '常州市' },
      { code: '320500', name: '苏州市' },
      { code: '320600', name: '南通市' },
      { code: '320700', name: '连云港市' },
      { code: '320800', name: '淮安市' },
      { code: '320900', name: '盐城市' },
      { code: '321000', name: '扬州市' },
      { code: '321100', name: '镇江市' },
      { code: '321200', name: '泰州市' },
      { code: '321300', name: '宿迁市' },
    ],
    // 浙江省
    '330000': [
      { code: '330100', name: '杭州市' },
      { code: '330200', name: '宁波市' },
      { code: '330300', name: '温州市' },
      { code: '330400', name: '嘉兴市' },
      { code: '330500', name: '湖州市' },
      { code: '330600', name: '绍兴市' },
      { code: '330700', name: '金华市' },
      { code: '330800', name: '衢州市' },
      { code: '330900', name: '舟山市' },
      { code: '331000', name: '台州市' },
      { code: '331100', name: '丽水市' },
    ],
    // 安徽省
    '340000': [
      { code: '340100', name: '合肥市' },
      { code: '340200', name: '芜湖市' },
      { code: '340300', name: '蚌埠市' },
      { code: '340400', name: '淮南市' },
      { code: '340500', name: '马鞍山市' },
      { code: '340600', name: '淮北市' },
      { code: '340700', name: '铜陵市' },
      { code: '340800', name: '安庆市' },
      { code: '341000', name: '黄山市' },
      { code: '341100', name: '滁州市' },
      { code: '341200', name: '阜阳市' },
      { code: '341300', name: '宿州市' },
      { code: '341500', name: '六安市' },
      { code: '341600', name: '亳州市' },
      { code: '341700', name: '池州市' },
      { code: '341800', name: '宣城市' },
    ],
    // 福建省
    '350000': [
      { code: '350100', name: '福州市' },
      { code: '350200', name: '厦门市' },
      { code: '350300', name: '莆田市' },
      { code: '350400', name: '三明市' },
      { code: '350500', name: '泉州市' },
      { code: '350600', name: '漳州市' },
      { code: '350700', name: '南平市' },
      { code: '350800', name: '龙岩市' },
      { code: '350900', name: '宁德市' },
    ],
    // 江西省
    '360000': [
      { code: '360100', name: '南昌市' },
      { code: '360200', name: '景德镇市' },
      { code: '360300', name: '萍乡市' },
      { code: '360400', name: '九江市' },
      { code: '360500', name: '新余市' },
      { code: '360600', name: '鹰潭市' },
      { code: '360700', name: '赣州市' },
      { code: '360800', name: '吉安市' },
      { code: '360900', name: '宜春市' },
      { code: '361000', name: '抚州市' },
      { code: '361100', name: '上饶市' },
    ],
    // 山东省
    '370000': [
      { code: '370100', name: '济南市' },
      { code: '370200', name: '青岛市' },
      { code: '370300', name: '淄博市' },
      { code: '370400', name: '枣庄市' },
      { code: '370500', name: '东营市' },
      { code: '370600', name: '烟台市' },
      { code: '370700', name: '潍坊市' },
      { code: '370800', name: '济宁市' },
      { code: '370900', name: '泰安市' },
      { code: '371000', name: '威海市' },
      { code: '371100', name: '日照市' },
      { code: '371300', name: '临沂市' },
      { code: '371400', name: '德州市' },
      { code: '371500', name: '聊城市' },
      { code: '371600', name: '滨州市' },
      { code: '371700', name: '菏泽市' },
    ],
    // 河南省
    '410000': [
      { code: '410100', name: '郑州市' },
      { code: '410200', name: '开封市' },
      { code: '410300', name: '洛阳市' },
      { code: '410400', name: '平顶山市' },
      { code: '410500', name: '安阳市' },
      { code: '410600', name: '鹤壁市' },
      { code: '410700', name: '新乡市' },
      { code: '410800', name: '焦作市' },
      { code: '410900', name: '濮阳市' },
      { code: '411000', name: '许昌市' },
      { code: '411100', name: '漯河市' },
      { code: '411200', name: '三门峡市' },
      { code: '411300', name: '南阳市' },
      { code: '411400', name: '商丘市' },
      { code: '411500', name: '信阳市' },
      { code: '411600', name: '周口市' },
      { code: '411700', name: '驻马店市' },
    ],
    // 湖北省
    '420000': [
      { code: '420100', name: '武汉市' },
      { code: '420200', name: '黄石市' },
      { code: '420300', name: '十堰市' },
      { code: '420500', name: '宜昌市' },
      { code: '420600', name: '襄阳市' },
      { code: '420700', name: '鄂州市' },
      { code: '420800', name: '荆门市' },
      { code: '420900', name: '孝感市' },
      { code: '421000', name: '荆州市' },
      { code: '421100', name: '黄冈市' },
      { code: '421200', name: '咸宁市' },
      { code: '421300', name: '随州市' },
    ],
    // 湖南省
    '430000': [
      { code: '430100', name: '长沙市' },
      { code: '430200', name: '株洲市' },
      { code: '430300', name: '湘潭市' },
      { code: '430400', name: '衡阳市' },
      { code: '430500', name: '邵阳市' },
      { code: '430600', name: '岳阳市' },
      { code: '430700', name: '常德市' },
      { code: '430800', name: '张家界市' },
      { code: '430900', name: '益阳市' },
      { code: '431000', name: '郴州市' },
      { code: '431100', name: '永州市' },
      { code: '431200', name: '怀化市' },
      { code: '431300', name: '娄底市' },
    ],
    // 广东省
    '440000': [
      { code: '440100', name: '广州市' },
      { code: '440200', name: '韶关市' },
      { code: '440300', name: '深圳市' },
      { code: '440400', name: '珠海市' },
      { code: '440500', name: '汕头市' },
      { code: '440600', name: '佛山市' },
      { code: '440700', name: '江门市' },
      { code: '440800', name: '湛江市' },
      { code: '440900', name: '茂名市' },
      { code: '441200', name: '肇庆市' },
      { code: '441300', name: '惠州市' },
      { code: '441400', name: '梅州市' },
      { code: '441500', name: '汕尾市' },
      { code: '441600', name: '河源市' },
      { code: '441700', name: '阳江市' },
      { code: '441800', name: '清远市' },
      { code: '441900', name: '东莞市' },
      { code: '442000', name: '中山市' },
      { code: '445100', name: '潮州市' },
      { code: '445200', name: '揭阳市' },
      { code: '445300', name: '云浮市' },
    ],
    // 广西壮族自治区
    '450000': [
      { code: '450100', name: '南宁市' },
      { code: '450200', name: '柳州市' },
      { code: '450300', name: '桂林市' },
      { code: '450400', name: '梧州市' },
      { code: '450500', name: '北海市' },
      { code: '450600', name: '防城港市' },
      { code: '450700', name: '钦州市' },
      { code: '450800', name: '贵港市' },
      { code: '450900', name: '玉林市' },
      { code: '451000', name: '百色市' },
      { code: '451100', name: '贺州市' },
      { code: '451200', name: '河池市' },
      { code: '451300', name: '来宾市' },
      { code: '451400', name: '崇左市' },
    ],
    // 海南省
    '460000': [
      { code: '460100', name: '海口市' },
      { code: '460200', name: '三亚市' },
      { code: '460300', name: '三沙市' },
      { code: '460400', name: '儋州市' },
    ],
    // 重庆市
    '500000': [{ code: '500100', name: '重庆市' }],
    // 四川省
    '510000': [
      { code: '510100', name: '成都市' },
      { code: '510300', name: '自贡市' },
      { code: '510400', name: '攀枝花市' },
      { code: '510500', name: '泸州市' },
      { code: '510600', name: '德阳市' },
      { code: '510700', name: '绵阳市' },
      { code: '510800', name: '广元市' },
      { code: '510900', name: '遂宁市' },
      { code: '511000', name: '内江市' },
      { code: '511100', name: '乐山市' },
      { code: '511300', name: '南充市' },
      { code: '511400', name: '眉山市' },
      { code: '511500', name: '宜宾市' },
      { code: '511600', name: '广安市' },
      { code: '511700', name: '达州市' },
      { code: '511800', name: '雅安市' },
      { code: '511900', name: '巴中市' },
      { code: '512000', name: '资阳市' },
    ],
    // 贵州省
    '520000': [
      { code: '520100', name: '贵阳市' },
      { code: '520200', name: '六盘水市' },
      { code: '520300', name: '遵义市' },
      { code: '520400', name: '安顺市' },
      { code: '520500', name: '毕节市' },
      { code: '520600', name: '铜仁市' },
    ],
    // 云南省
    '530000': [
      { code: '530100', name: '昆明市' },
      { code: '530300', name: '曲靖市' },
      { code: '530400', name: '玉溪市' },
      { code: '530500', name: '保山市' },
      { code: '530600', name: '昭通市' },
      { code: '530700', name: '丽江市' },
      { code: '530800', name: '普洱市' },
      { code: '530900', name: '临沧市' },
    ],
    // 西藏自治区
    '540000': [
      { code: '540100', name: '拉萨市' },
      { code: '540200', name: '日喀则市' },
      { code: '540300', name: '昌都市' },
      { code: '540400', name: '林芝市' },
      { code: '540500', name: '山南市' },
      { code: '540600', name: '那曲市' },
    ],
    // 陕西省
    '610000': [
      { code: '610100', name: '西安市' },
      { code: '610200', name: '铜川市' },
      { code: '610300', name: '宝鸡市' },
      { code: '610400', name: '咸阳市' },
      { code: '610500', name: '渭南市' },
      { code: '610600', name: '延安市' },
      { code: '610700', name: '汉中市' },
      { code: '610800', name: '榆林市' },
      { code: '610900', name: '安康市' },
      { code: '611000', name: '商洛市' },
    ],
    // 甘肃省
    '620000': [
      { code: '620100', name: '兰州市' },
      { code: '620200', name: '嘉峪关市' },
      { code: '620300', name: '金昌市' },
      { code: '620400', name: '白银市' },
      { code: '620500', name: '天水市' },
      { code: '620600', name: '武威市' },
      { code: '620700', name: '张掖市' },
      { code: '620800', name: '平凉市' },
      { code: '620900', name: '酒泉市' },
      { code: '621000', name: '庆阳市' },
      { code: '621100', name: '定西市' },
      { code: '621200', name: '陇南市' },
    ],
    // 青海省
    '630000': [
      { code: '630100', name: '西宁市' },
      { code: '630200', name: '海东市' },
    ],
    // 宁夏回族自治区
    '640000': [
      { code: '640100', name: '银川市' },
      { code: '640200', name: '石嘴山市' },
      { code: '640300', name: '吴忠市' },
      { code: '640400', name: '固原市' },
      { code: '640500', name: '中卫市' },
    ],
    // 新疆维吾尔自治区
    '650000': [
      { code: '650100', name: '乌鲁木齐市' },
      { code: '650200', name: '克拉玛依市' },
      { code: '650400', name: '吐鲁番市' },
      { code: '650500', name: '哈密市' },
    ],
  } as Record<string, { code: string; name: string }[]>,
  districts: {
    // 泉州市
    '350500': [
      { code: '350502', name: '鲤城区' },
      { code: '350503', name: '丰泽区' },
      { code: '350504', name: '洛江区' },
      { code: '350505', name: '泉港区' },
      { code: '350521', name: '惠安县' },
      { code: '350524', name: '安溪县' },
      { code: '350525', name: '永春县' },
      { code: '350526', name: '德化县' },
      { code: '350581', name: '石狮市' },
      { code: '350582', name: '晋江市' },
      { code: '350583', name: '南安市' },
    ],
    // 福州市
    '350100': [
      { code: '350102', name: '鼓楼区' },
      { code: '350103', name: '台江区' },
      { code: '350104', name: '仓山区' },
      { code: '350105', name: '马尾区' },
      { code: '350111', name: '晋安区' },
      { code: '350112', name: '长乐区' },
      { code: '350121', name: '闽侯县' },
      { code: '350122', name: '连江县' },
      { code: '350123', name: '罗源县' },
      { code: '350124', name: '闽清县' },
      { code: '350125', name: '永泰县' },
      { code: '350128', name: '平潭县' },
      { code: '350181', name: '福清市' },
    ],
    // 厦门市
    '350200': [
      { code: '350203', name: '思明区' },
      { code: '350205', name: '海沧区' },
      { code: '350206', name: '湖里区' },
      { code: '350211', name: '集美区' },
      { code: '350212', name: '同安区' },
      { code: '350213', name: '翔安区' },
    ],
    // 广州市
    '440100': [
      { code: '440103', name: '荔湾区' },
      { code: '440104', name: '越秀区' },
      { code: '440105', name: '海珠区' },
      { code: '440106', name: '天河区' },
      { code: '440111', name: '白云区' },
      { code: '440112', name: '黄埔区' },
      { code: '440113', name: '番禺区' },
      { code: '440114', name: '花都区' },
      { code: '440115', name: '南沙区' },
      { code: '440117', name: '从化区' },
      { code: '440118', name: '增城区' },
    ],
    // 深圳市
    '440300': [
      { code: '440303', name: '罗湖区' },
      { code: '440304', name: '福田区' },
      { code: '440305', name: '南山区' },
      { code: '440306', name: '宝安区' },
      { code: '440307', name: '龙岗区' },
      { code: '440308', name: '盐田区' },
      { code: '440309', name: '龙华区' },
      { code: '440310', name: '坪山区' },
      { code: '440311', name: '光明区' },
    ],
    // 杭州市
    '330100': [
      { code: '330102', name: '上城区' },
      { code: '330105', name: '拱墅区' },
      { code: '330106', name: '西湖区' },
      { code: '330108', name: '滨江区' },
      { code: '330109', name: '萧山区' },
      { code: '330110', name: '余杭区' },
      { code: '330111', name: '富阳区' },
      { code: '330112', name: '临安区' },
      { code: '330113', name: '临平区' },
      { code: '330114', name: '钱塘区' },
      { code: '330122', name: '桐庐县' },
      { code: '330127', name: '淳安县' },
      { code: '330182', name: '建德市' },
    ],
    // 北京市
    '110100': [
      { code: '110101', name: '东城区' },
      { code: '110102', name: '西城区' },
      { code: '110105', name: '朝阳区' },
      { code: '110106', name: '丰台区' },
      { code: '110107', name: '石景山区' },
      { code: '110108', name: '海淀区' },
      { code: '110109', name: '门头沟区' },
      { code: '110111', name: '房山区' },
      { code: '110112', name: '通州区' },
      { code: '110113', name: '顺义区' },
      { code: '110114', name: '昌平区' },
      { code: '110115', name: '大兴区' },
      { code: '110116', name: '怀柔区' },
      { code: '110117', name: '平谷区' },
      { code: '110118', name: '密云区' },
      { code: '110119', name: '延庆区' },
    ],
    // 上海市
    '310100': [
      { code: '310101', name: '黄浦区' },
      { code: '310104', name: '徐汇区' },
      { code: '310105', name: '长宁区' },
      { code: '310106', name: '静安区' },
      { code: '310107', name: '普陀区' },
      { code: '310109', name: '虹口区' },
      { code: '310110', name: '杨浦区' },
      { code: '310112', name: '闵行区' },
      { code: '310113', name: '宝山区' },
      { code: '310114', name: '嘉定区' },
      { code: '310115', name: '浦东新区' },
      { code: '310116', name: '金山区' },
      { code: '310117', name: '松江区' },
      { code: '310118', name: '青浦区' },
      { code: '310120', name: '奉贤区' },
      { code: '310151', name: '崇明区' },
    ],
    // 天津市
    '120100': [
      { code: '120101', name: '和平区' },
      { code: '120102', name: '河东区' },
      { code: '120103', name: '河西区' },
      { code: '120104', name: '南开区' },
      { code: '120105', name: '河北区' },
      { code: '120106', name: '红桥区' },
      { code: '120110', name: '东丽区' },
      { code: '120111', name: '西青区' },
      { code: '120112', name: '津南区' },
      { code: '120113', name: '北辰区' },
      { code: '120114', name: '武清区' },
      { code: '120115', name: '宝坻区' },
      { code: '120116', name: '滨海新区' },
      { code: '120117', name: '宁河区' },
      { code: '120118', name: '静海区' },
      { code: '120119', name: '蓟州区' },
    ],
    // 重庆市主城区
    '500100': [
      { code: '500101', name: '万州区' },
      { code: '500102', name: '涪陵区' },
      { code: '500103', name: '渝中区' },
      { code: '500104', name: '大渡口区' },
      { code: '500105', name: '江北区' },
      { code: '500106', name: '沙坪坝区' },
      { code: '500107', name: '九龙坡区' },
      { code: '500108', name: '南岸区' },
      { code: '500109', name: '北碚区' },
      { code: '500110', name: '綦江区' },
      { code: '500111', name: '大足区' },
      { code: '500112', name: '渝北区' },
      { code: '500113', name: '巴南区' },
      { code: '500114', name: '黔江区' },
      { code: '500115', name: '长寿区' },
      { code: '500116', name: '江津区' },
      { code: '500117', name: '合川区' },
      { code: '500118', name: '永川区' },
      { code: '500119', name: '南川区' },
      { code: '500120', name: '璧山区' },
      { code: '500151', name: '铜梁区' },
      { code: '500152', name: '潼南区' },
      { code: '500153', name: '荣昌区' },
      { code: '500154', name: '开州区' },
      { code: '500155', name: '梁平区' },
      { code: '500156', name: '武隆区' },
    ],
    // 石家庄市
    '130100': [
      { code: '130102', name: '长安区' },
      { code: '130104', name: '桥西区' },
      { code: '130105', name: '新华区' },
      { code: '130107', name: '井陉矿区' },
      { code: '130108', name: '裕华区' },
      { code: '130109', name: '藁城区' },
      { code: '130110', name: '鹿泉区' },
      { code: '130111', name: '栾城区' },
      { code: '130121', name: '井陉县' },
      { code: '130123', name: '正定县' },
      { code: '130125', name: '行唐县' },
      { code: '130126', name: '灵寿县' },
      { code: '130127', name: '高邑县' },
      { code: '130128', name: '深泽县' },
      { code: '130129', name: '赞皇县' },
      { code: '130130', name: '无极县' },
      { code: '130131', name: '平山县' },
      { code: '130132', name: '元氏县' },
      { code: '130133', name: '赵县' },
      { code: '130181', name: '辛集市' },
      { code: '130183', name: '晋州市' },
      { code: '130184', name: '新乐市' },
    ],
    // 太原市
    '140100': [
      { code: '140105', name: '小店区' },
      { code: '140106', name: '迎泽区' },
      { code: '140107', name: '杏花岭区' },
      { code: '140108', name: '尖草坪区' },
      { code: '140109', name: '万柏林区' },
      { code: '140110', name: '晋源区' },
      { code: '140121', name: '清徐县' },
      { code: '140122', name: '阳曲县' },
      { code: '140123', name: '娄烦县' },
      { code: '140181', name: '古交市' },
    ],
    // 呼和浩特市
    '150100': [
      { code: '150102', name: '新城区' },
      { code: '150103', name: '回民区' },
      { code: '150104', name: '玉泉区' },
      { code: '150105', name: '赛罕区' },
      { code: '150121', name: '土默特左旗' },
      { code: '150122', name: '托克托县' },
      { code: '150123', name: '和林格尔县' },
      { code: '150124', name: '清水河县' },
      { code: '150125', name: '武川县' },
    ],
    // 沈阳市
    '210100': [
      { code: '210102', name: '和平区' },
      { code: '210103', name: '沈河区' },
      { code: '210104', name: '大东区' },
      { code: '210105', name: '皇姑区' },
      { code: '210106', name: '铁西区' },
      { code: '210111', name: '苏家屯区' },
      { code: '210112', name: '浑南区' },
      { code: '210113', name: '沈北新区' },
      { code: '210114', name: '于洪区' },
      { code: '210115', name: '辽中区' },
      { code: '210123', name: '康平县' },
      { code: '210124', name: '法库县' },
      { code: '210181', name: '新民市' },
    ],
    // 大连市
    '210200': [
      { code: '210202', name: '中山区' },
      { code: '210203', name: '西岗区' },
      { code: '210204', name: '沙河口区' },
      { code: '210211', name: '甘井子区' },
      { code: '210212', name: '旅顺口区' },
      { code: '210213', name: '金州区' },
      { code: '210214', name: '普兰店区' },
      { code: '210224', name: '长海县' },
      { code: '210281', name: '瓦房店市' },
      { code: '210283', name: '庄河市' },
    ],
    // 长春市
    '220100': [
      { code: '220102', name: '南关区' },
      { code: '220103', name: '宽城区' },
      { code: '220104', name: '朝阳区' },
      { code: '220105', name: '二道区' },
      { code: '220106', name: '绿园区' },
      { code: '220112', name: '双阳区' },
      { code: '220113', name: '九台区' },
      { code: '220122', name: '农安县' },
      { code: '220182', name: '榆树市' },
      { code: '220183', name: '德惠市' },
      { code: '220184', name: '公主岭市' },
    ],
    // 哈尔滨市
    '230100': [
      { code: '230102', name: '道里区' },
      { code: '230103', name: '南岗区' },
      { code: '230104', name: '道外区' },
      { code: '230108', name: '平房区' },
      { code: '230109', name: '松北区' },
      { code: '230110', name: '香坊区' },
      { code: '230111', name: '呼兰区' },
      { code: '230112', name: '阿城区' },
      { code: '230113', name: '双城区' },
      { code: '230123', name: '依兰县' },
      { code: '230124', name: '方正县' },
      { code: '230125', name: '宾县' },
      { code: '230126', name: '巴彦县' },
      { code: '230127', name: '木兰县' },
      { code: '230128', name: '通河县' },
      { code: '230129', name: '延寿县' },
      { code: '230183', name: '尚志市' },
      { code: '230184', name: '五常市' },
    ],
    // 南京市
    '320100': [
      { code: '320102', name: '玄武区' },
      { code: '320104', name: '秦淮区' },
      { code: '320105', name: '建邺区' },
      { code: '320106', name: '鼓楼区' },
      { code: '320111', name: '浦口区' },
      { code: '320113', name: '栖霞区' },
      { code: '320114', name: '雨花台区' },
      { code: '320115', name: '江宁区' },
      { code: '320116', name: '六合区' },
      { code: '320117', name: '溧水区' },
      { code: '320118', name: '高淳区' },
    ],
    // 苏州市
    '320500': [
      { code: '320505', name: '虎丘区' },
      { code: '320506', name: '吴中区' },
      { code: '320507', name: '相城区' },
      { code: '320508', name: '姑苏区' },
      { code: '320509', name: '吴江区' },
      { code: '320581', name: '常熟市' },
      { code: '320582', name: '张家港市' },
      { code: '320583', name: '昆山市' },
      { code: '320585', name: '太仓市' },
    ],
    // 无锡市
    '320200': [
      { code: '320205', name: '锡山区' },
      { code: '320206', name: '惠山区' },
      { code: '320211', name: '滨湖区' },
      { code: '320213', name: '梁溪区' },
      { code: '320214', name: '新吴区' },
      { code: '320281', name: '江阴市' },
      { code: '320282', name: '宜兴市' },
    ],
    // 宁波市
    '330200': [
      { code: '330203', name: '海曙区' },
      { code: '330205', name: '江北区' },
      { code: '330206', name: '北仑区' },
      { code: '330211', name: '镇海区' },
      { code: '330212', name: '鄞州区' },
      { code: '330213', name: '奉化区' },
      { code: '330225', name: '象山县' },
      { code: '330226', name: '宁海县' },
      { code: '330281', name: '余姚市' },
      { code: '330282', name: '慈溪市' },
    ],
    // 温州市
    '330300': [
      { code: '330302', name: '鹿城区' },
      { code: '330303', name: '龙湾区' },
      { code: '330304', name: '瓯海区' },
      { code: '330305', name: '洞头区' },
      { code: '330324', name: '永嘉县' },
      { code: '330326', name: '平阳县' },
      { code: '330327', name: '苍南县' },
      { code: '330328', name: '文成县' },
      { code: '330329', name: '泰顺县' },
      { code: '330381', name: '瑞安市' },
      { code: '330382', name: '乐清市' },
      { code: '330383', name: '龙港市' },
    ],
    // 合肥市
    '340100': [
      { code: '340102', name: '瑶海区' },
      { code: '340103', name: '庐阳区' },
      { code: '340104', name: '蜀山区' },
      { code: '340111', name: '包河区' },
      { code: '340121', name: '长丰县' },
      { code: '340122', name: '肥东县' },
      { code: '340123', name: '肥西县' },
      { code: '340124', name: '庐江县' },
      { code: '340181', name: '巢湖市' },
    ],
    // 漳州市
    '350600': [
      { code: '350602', name: '芗城区' },
      { code: '350603', name: '龙文区' },
      { code: '350604', name: '龙海区' },
      { code: '350605', name: '长泰区' },
      { code: '350622', name: '云霄县' },
      { code: '350623', name: '漳浦县' },
      { code: '350624', name: '诏安县' },
      { code: '350626', name: '东山县' },
      { code: '350627', name: '南靖县' },
      { code: '350628', name: '平和县' },
      { code: '350629', name: '华安县' },
    ],
    // 莆田市
    '350300': [
      { code: '350302', name: '城厢区' },
      { code: '350303', name: '涵江区' },
      { code: '350304', name: '荔城区' },
      { code: '350305', name: '秀屿区' },
      { code: '350322', name: '仙游县' },
    ],
    // 南昌市
    '360100': [
      { code: '360102', name: '东湖区' },
      { code: '360103', name: '西湖区' },
      { code: '360104', name: '青云谱区' },
      { code: '360111', name: '青山湖区' },
      { code: '360112', name: '新建区' },
      { code: '360113', name: '红谷滩区' },
      { code: '360121', name: '南昌县' },
      { code: '360123', name: '安义县' },
      { code: '360124', name: '进贤县' },
    ],
    // 济南市
    '370100': [
      { code: '370102', name: '历下区' },
      { code: '370103', name: '市中区' },
      { code: '370104', name: '槐荫区' },
      { code: '370105', name: '天桥区' },
      { code: '370112', name: '历城区' },
      { code: '370113', name: '长清区' },
      { code: '370114', name: '章丘区' },
      { code: '370115', name: '济阳区' },
      { code: '370116', name: '莱芜区' },
      { code: '370117', name: '钢城区' },
      { code: '370124', name: '平阴县' },
      { code: '370126', name: '商河县' },
    ],
    // 青岛市
    '370200': [
      { code: '370202', name: '市南区' },
      { code: '370203', name: '市北区' },
      { code: '370211', name: '黄岛区' },
      { code: '370212', name: '崂山区' },
      { code: '370213', name: '李沧区' },
      { code: '370214', name: '城阳区' },
      { code: '370215', name: '即墨区' },
      { code: '370281', name: '胶州市' },
      { code: '370283', name: '平度市' },
      { code: '370285', name: '莱西市' },
    ],
    // 郑州市
    '410100': [
      { code: '410102', name: '中原区' },
      { code: '410103', name: '二七区' },
      { code: '410104', name: '管城回族区' },
      { code: '410105', name: '金水区' },
      { code: '410106', name: '上街区' },
      { code: '410108', name: '惠济区' },
      { code: '410122', name: '中牟县' },
      { code: '410181', name: '巩义市' },
      { code: '410182', name: '荥阳市' },
      { code: '410183', name: '新密市' },
      { code: '410184', name: '新郑市' },
      { code: '410185', name: '登封市' },
    ],
    // 武汉市
    '420100': [
      { code: '420102', name: '江岸区' },
      { code: '420103', name: '江汉区' },
      { code: '420104', name: '硚口区' },
      { code: '420105', name: '汉阳区' },
      { code: '420106', name: '武昌区' },
      { code: '420107', name: '青山区' },
      { code: '420111', name: '洪山区' },
      { code: '420112', name: '东西湖区' },
      { code: '420113', name: '汉南区' },
      { code: '420114', name: '蔡甸区' },
      { code: '420115', name: '江夏区' },
      { code: '420116', name: '黄陂区' },
      { code: '420117', name: '新洲区' },
    ],
    // 长沙市
    '430100': [
      { code: '430102', name: '芙蓉区' },
      { code: '430103', name: '天心区' },
      { code: '430104', name: '岳麓区' },
      { code: '430105', name: '开福区' },
      { code: '430111', name: '雨花区' },
      { code: '430112', name: '望城区' },
      { code: '430121', name: '长沙县' },
      { code: '430181', name: '浏阳市' },
      { code: '430182', name: '宁乡市' },
    ],
    // 佛山市
    '440600': [
      { code: '440604', name: '禅城区' },
      { code: '440605', name: '南海区' },
      { code: '440606', name: '顺德区' },
      { code: '440607', name: '三水区' },
      { code: '440608', name: '高明区' },
    ],
    // 东莞市
    '441900': [
      { code: '441900003', name: '东城街道' },
      { code: '441900004', name: '南城街道' },
      { code: '441900005', name: '万江街道' },
      { code: '441900006', name: '莞城街道' },
      { code: '441900101', name: '石碣镇' },
      { code: '441900102', name: '石龙镇' },
      { code: '441900103', name: '茶山镇' },
      { code: '441900104', name: '石排镇' },
      { code: '441900105', name: '企石镇' },
      { code: '441900106', name: '横沥镇' },
      { code: '441900107', name: '桥头镇' },
      { code: '441900108', name: '谢岗镇' },
      { code: '441900109', name: '东坑镇' },
      { code: '441900110', name: '常平镇' },
      { code: '441900111', name: '寮步镇' },
      { code: '441900112', name: '樟木头镇' },
      { code: '441900113', name: '大朗镇' },
      { code: '441900114', name: '黄江镇' },
      { code: '441900115', name: '清溪镇' },
      { code: '441900116', name: '塘厦镇' },
      { code: '441900117', name: '凤岗镇' },
      { code: '441900118', name: '大岭山镇' },
      { code: '441900119', name: '长安镇' },
      { code: '441900121', name: '虎门镇' },
      { code: '441900122', name: '厚街镇' },
      { code: '441900123', name: '沙田镇' },
      { code: '441900124', name: '道滘镇' },
      { code: '441900125', name: '洪梅镇' },
      { code: '441900126', name: '麻涌镇' },
      { code: '441900127', name: '望牛墩镇' },
      { code: '441900128', name: '中堂镇' },
      { code: '441900129', name: '高埗镇' },
      { code: '441900401', name: '松山湖' },
      { code: '441900402', name: '滨海湾新区' },
    ],
    // 珠海市
    '440400': [
      { code: '440402', name: '香洲区' },
      { code: '440403', name: '斗门区' },
      { code: '440404', name: '金湾区' },
    ],
    // 南宁市
    '450100': [
      { code: '450102', name: '兴宁区' },
      { code: '450103', name: '青秀区' },
      { code: '450105', name: '江南区' },
      { code: '450107', name: '西乡塘区' },
      { code: '450108', name: '良庆区' },
      { code: '450109', name: '邕宁区' },
      { code: '450110', name: '武鸣区' },
      { code: '450123', name: '隆安县' },
      { code: '450124', name: '马山县' },
      { code: '450125', name: '上林县' },
      { code: '450126', name: '宾阳县' },
      { code: '450181', name: '横州市' },
    ],
    // 海口市
    '460100': [
      { code: '460105', name: '秀英区' },
      { code: '460106', name: '龙华区' },
      { code: '460107', name: '琼山区' },
      { code: '460108', name: '美兰区' },
    ],
    // 三亚市
    '460200': [
      { code: '460202', name: '海棠区' },
      { code: '460203', name: '吉阳区' },
      { code: '460204', name: '天涯区' },
      { code: '460205', name: '崖州区' },
    ],
    // 成都市
    '510100': [
      { code: '510104', name: '锦江区' },
      { code: '510105', name: '青羊区' },
      { code: '510106', name: '金牛区' },
      { code: '510107', name: '武侯区' },
      { code: '510108', name: '成华区' },
      { code: '510112', name: '龙泉驿区' },
      { code: '510113', name: '青白江区' },
      { code: '510114', name: '新都区' },
      { code: '510115', name: '温江区' },
      { code: '510116', name: '双流区' },
      { code: '510117', name: '郫都区' },
      { code: '510118', name: '新津区' },
      { code: '510121', name: '金堂县' },
      { code: '510129', name: '大邑县' },
      { code: '510131', name: '蒲江县' },
      { code: '510181', name: '都江堰市' },
      { code: '510182', name: '彭州市' },
      { code: '510183', name: '邛崃市' },
      { code: '510184', name: '崇州市' },
      { code: '510185', name: '简阳市' },
    ],
    // 贵阳市
    '520100': [
      { code: '520102', name: '南明区' },
      { code: '520103', name: '云岩区' },
      { code: '520111', name: '花溪区' },
      { code: '520112', name: '乌当区' },
      { code: '520113', name: '白云区' },
      { code: '520115', name: '观山湖区' },
      { code: '520121', name: '开阳县' },
      { code: '520122', name: '息烽县' },
      { code: '520123', name: '修文县' },
      { code: '520181', name: '清镇市' },
    ],
    // 昆明市
    '530100': [
      { code: '530102', name: '五华区' },
      { code: '530103', name: '盘龙区' },
      { code: '530111', name: '官渡区' },
      { code: '530112', name: '西山区' },
      { code: '530113', name: '东川区' },
      { code: '530114', name: '呈贡区' },
      { code: '530115', name: '晋宁区' },
      { code: '530124', name: '富民县' },
      { code: '530125', name: '宜良县' },
      { code: '530126', name: '石林彝族自治县' },
      { code: '530127', name: '嵩明县' },
      { code: '530128', name: '禄劝彝族苗族自治县' },
      { code: '530129', name: '寻甸回族彝族自治县' },
      { code: '530181', name: '安宁市' },
    ],
    // 拉萨市
    '540100': [
      { code: '540102', name: '城关区' },
      { code: '540103', name: '堆龙德庆区' },
      { code: '540104', name: '达孜区' },
      { code: '540121', name: '林周县' },
      { code: '540122', name: '当雄县' },
      { code: '540123', name: '尼木县' },
      { code: '540124', name: '曲水县' },
      { code: '540127', name: '墨竹工卡县' },
    ],
    // 西安市
    '610100': [
      { code: '610102', name: '新城区' },
      { code: '610103', name: '碑林区' },
      { code: '610104', name: '莲湖区' },
      { code: '610111', name: '灞桥区' },
      { code: '610112', name: '未央区' },
      { code: '610113', name: '雁塔区' },
      { code: '610114', name: '阎良区' },
      { code: '610115', name: '临潼区' },
      { code: '610116', name: '长安区' },
      { code: '610117', name: '高陵区' },
      { code: '610118', name: '鄠邑区' },
      { code: '610122', name: '蓝田县' },
      { code: '610124', name: '周至县' },
    ],
    // 兰州市
    '620100': [
      { code: '620102', name: '城关区' },
      { code: '620103', name: '七里河区' },
      { code: '620104', name: '西固区' },
      { code: '620105', name: '安宁区' },
      { code: '620111', name: '红古区' },
      { code: '620121', name: '永登县' },
      { code: '620122', name: '皋兰县' },
      { code: '620123', name: '榆中县' },
    ],
    // 西宁市
    '630100': [
      { code: '630102', name: '城东区' },
      { code: '630103', name: '城中区' },
      { code: '630104', name: '城西区' },
      { code: '630105', name: '城北区' },
      { code: '630106', name: '湟中区' },
      { code: '630121', name: '大通回族土族自治县' },
      { code: '630123', name: '湟源县' },
    ],
    // 银川市
    '640100': [
      { code: '640104', name: '兴庆区' },
      { code: '640105', name: '西夏区' },
      { code: '640106', name: '金凤区' },
      { code: '640121', name: '永宁县' },
      { code: '640122', name: '贺兰县' },
      { code: '640181', name: '灵武市' },
    ],
    // 乌鲁木齐市
    '650100': [
      { code: '650102', name: '天山区' },
      { code: '650103', name: '沙依巴克区' },
      { code: '650104', name: '新市区' },
      { code: '650105', name: '水磨沟区' },
      { code: '650106', name: '头屯河区' },
      { code: '650107', name: '达坂城区' },
      { code: '650109', name: '米东区' },
      { code: '650121', name: '乌鲁木齐县' },
    ],
  } as Record<string, { code: string; name: string }[]>,
};

// 兼容历史脏数据：DB 里部分客户的省/市/县名缺少行政级别后缀（如"福建"vs"福建省"、
// "泉州"vs"泉州市"）。匹配时先 exact，再去掉常见后缀做 fuzzy。
const REGION_SUFFIX_RE =
  /(省|市|自治区|特别行政区|维吾尔自治区|壮族自治区|回族自治区|区|县|自治县|旗|自治旗)$/;
function normalizeRegionName(name: string): string {
  return name.replace(REGION_SUFFIX_RE, '');
}
function matchRegion<T extends { name: string }>(items: T[], target: string): T | undefined {
  if (!target) return undefined;
  const exact = items.find((i) => i.name === target);
  if (exact) return exact;
  const normalized = normalizeRegionName(target);
  if (!normalized) return undefined;
  return items.find((i) => normalizeRegionName(i.name) === normalized);
}

// 根据省份名称查找省份代码
function getProvinceCode(provinceName: string): string | undefined {
  return matchRegion(addressData.provinces, provinceName)?.code;
}

// 根据城市名称和省份代码查找城市代码
function getCityCode(cityName: string, provinceCode: string): string | undefined {
  const cities = addressData.cities[provinceCode] || [];
  return matchRegion(cities, cityName)?.code;
}

export interface AddressValue {
  province: string;
  city: string;
  district: string;
  detail: string;
}

interface AddressPickerProps {
  value?: AddressValue;
  onChange?: (value: AddressValue) => void;
  placeholder?: string;
  disabled?: boolean;
  includeUnknownOption?: boolean;
  className?: string;
  'data-testid'?: string;
}

// 可搜索的下拉选择组件
function AddressSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  testId,
}: {
  options: { code: string; name: string }[];
  value: string;
  onChange: (name: string) => void;
  placeholder: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);

  const handleSelect = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-9 flex-1 justify-between px-3 py-2 text-left font-normal"
          data-testid={testId}
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || placeholder}
          </span>
          <ChevronDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={`搜索${placeholder.replace('选择', '')}...`}
            data-testid={`${testId}-search`}
          />
          <CommandList>
            {options.length === 0 ? (
              <CommandEmpty>请先选择上级区域</CommandEmpty>
            ) : (
              <>
                <CommandEmpty>无匹配结果</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.code}
                      value={option.name}
                      onSelect={() => handleSelect(option.name)}
                      data-testid={`${testId}-option-${option.code}`}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === option.name ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      {option.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function AddressPicker({
  value = { province: '', city: '', district: '', detail: '' },
  onChange,
  disabled = false,
  includeUnknownOption = false,
  className,
  'data-testid': dataTestId,
}: AddressPickerProps) {
  const isUnknownProvince = value.province === UNKNOWN_REGION_VALUE;
  const isUnknownCity = value.city === UNKNOWN_REGION_VALUE;

  // 获取当前省份代码
  const provinceCode = isUnknownProvince ? undefined : getProvinceCode(value.province);

  // 获取当前城市代码
  const cityCode =
    provinceCode && !isUnknownCity ? getCityCode(value.city, provinceCode) : undefined;

  // 可用的城市列表
  const availableCities = provinceCode ? addressData.cities[provinceCode] || [] : [];

  // 可用的区县列表
  const availableDistricts = cityCode ? addressData.districts[cityCode] || [] : [];

  const provinceOptions = includeUnknownOption
    ? [UNKNOWN_REGION_OPTION, ...addressData.provinces]
    : addressData.provinces;
  const cityOptions = includeUnknownOption
    ? [UNKNOWN_REGION_OPTION, ...availableCities]
    : availableCities;
  const districtOptions = includeUnknownOption
    ? [UNKNOWN_REGION_OPTION, ...availableDistricts]
    : availableDistricts;

  // 处理省份变化
  const handleProvinceChange = (provinceName: string) => {
    if (provinceName === UNKNOWN_REGION_VALUE) {
      onChange?.({
        province: UNKNOWN_REGION_VALUE,
        city: UNKNOWN_REGION_VALUE,
        district: UNKNOWN_REGION_VALUE,
        detail: value.detail,
      });
      return;
    }

    onChange?.({
      province: provinceName,
      city: '',
      district: '',
      detail: value.detail,
    });
  };

  // 处理城市变化
  const handleCityChange = (cityName: string) => {
    if (cityName === UNKNOWN_REGION_VALUE) {
      onChange?.({
        ...value,
        city: UNKNOWN_REGION_VALUE,
        district: UNKNOWN_REGION_VALUE,
      });
      return;
    }

    onChange?.({
      ...value,
      city: cityName,
      district: '',
    });
  };

  // 处理区县变化
  const handleDistrictChange = (districtName: string) => {
    onChange?.({
      ...value,
      district: districtName,
    });
  };

  // 处理详细地址变化
  const handleDetailChange = (detail: string) => {
    onChange?.({
      ...value,
      detail,
    });
  };

  return (
    <div className={cn('space-y-2', className)} data-testid={dataTestId}>
      {/* 省市区级联选择 */}
      <div className="flex gap-2">
        <AddressSelect
          options={provinceOptions}
          value={value.province}
          onChange={handleProvinceChange}
          placeholder="选择省份"
          disabled={disabled}
          testId="address-province-select"
        />
        <AddressSelect
          options={cityOptions}
          value={value.city}
          onChange={handleCityChange}
          placeholder="选择城市"
          disabled={disabled || !value.province || isUnknownProvince}
          testId="address-city-select"
        />
        <AddressSelect
          options={districtOptions}
          value={value.district}
          onChange={handleDistrictChange}
          placeholder="选择区县"
          disabled={disabled || !value.city || isUnknownProvince || isUnknownCity}
          testId="address-district-select"
        />
      </div>

      {/* 详细地址输入框 */}
      <Input
        value={value.detail}
        onChange={(e) => handleDetailChange(e.target.value)}
        placeholder="请输入详细地址（街道、门牌号等）"
        disabled={disabled}
        data-testid="address-detail-input"
      />
    </div>
  );
}

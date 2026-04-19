// icons.jsx — minimal stroke icons, 16px
const Icon = ({ d, size = 16, fill = "none", stroke = "currentColor" }) => (
  <svg className="nav-icon" width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const Icons = {
  home: <Icon d={<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>} />,
  grid: <Icon d={<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>} />,
  card: <Icon d={<><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M3 10h18" /></>} />,
  timeline: <Icon d={<><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="M6 8v8" /><path d="M10 6h10" /><path d="M10 18h6" /></>} />,
  bell: <Icon d={<><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 004 0" /></>} />,
  tree: <Icon d={<><circle cx="12" cy="4" r="1.5" /><circle cx="6" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /><circle cx="4" cy="20" r="1.5" /><circle cx="10" cy="20" r="1.5" /><circle cx="16" cy="20" r="1.5" /><circle cx="20" cy="20" r="1.5" /><path d="M12 5.5L7 10.5" /><path d="M12 5.5l5 5" /><path d="M6 13.5L4.5 18.5M6 13.5l3.5 5" /><path d="M18 13.5l-1.5 5M18 13.5l2 5" /></>} />,
  cart: <Icon d={<><path d="M3 4h3l2 12h11l2-8H7" /><circle cx="9" cy="20" r="1.2" /><circle cx="18" cy="20" r="1.2" /></>} />,
  shop: <Icon d={<><path d="M3 8l2-4h14l2 4" /><path d="M3 8v12h18V8" /><path d="M3 8a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" /></>} />,
  tag: <Icon d={<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="8" cy="8" r="1.5" /></>} />,
  settings: <Icon d={<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>} />,
  search: <Icon d={<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>} />,
  plus: <Icon d={<><path d="M12 5v14M5 12h14" /></>} />,
  camera: <Icon d={<><rect x="3" y="7" width="18" height="13" rx="1.5" /><path d="M8 7l2-3h4l2 3" /><circle cx="12" cy="13" r="3.5" /></>} />,
  beetle: <Icon d={<><path d="M12 3v4" /><path d="M9 4l3 2 3-2" /><ellipse cx="12" cy="13" rx="5" ry="7" /><path d="M12 7v14" /><path d="M7 10l-4 1M7 14l-4 0M7 18l-4 2" /><path d="M17 10l4 1M17 14l4 0M17 18l4 2" /></>} />,
};

window.Icons = Icons;

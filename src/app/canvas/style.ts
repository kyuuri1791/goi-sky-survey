// 地図の名前の文字（描くときと、視点を決めるときに名前の幅を見積もるときの両方で使う）

const FONT_FAMILY = "'Hiragino Sans', 'Noto Sans JP', sans-serif";

/** 選んだ語と近い語の名前の文字の大きさ（px） */
export const MARK_FONT_SIZE = 14;
export const MARK_FONT = `700 ${MARK_FONT_SIZE}px ${FONT_FAMILY}`;

/** ほかの語の名前の文字 */
export const labelFont = (size: number) => `500 ${size}px ${FONT_FAMILY}`;

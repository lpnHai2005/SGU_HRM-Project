# Utility to convert integer currency amount to Vietnamese words

UNIT_NAMES = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"]
DIGIT_NAMES = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]

def _read_three_digits(n: int, show_zero_hundred: bool = False) -> str:
    hundred = n // 100
    ten = (n % 100) // 10
    unit = n % 10
    res = []
    
    if hundred > 0 or show_zero_hundred:
        res.append(f"{DIGIT_NAMES[hundred]} trăm")
        
    if ten > 1:
        res.append(f"{DIGIT_NAMES[ten]} mươi")
        if unit == 1:
            res.append("mốt")
        elif unit == 5:
            res.append("lăm")
        elif unit > 0:
            res.append(DIGIT_NAMES[unit])
    elif ten == 1:
        res.append("mười")
        if unit == 5:
            res.append("lăm")
        elif unit > 0:
            res.append(DIGIT_NAMES[unit])
    elif ten == 0:
        if hundred > 0 or show_zero_hundred:
            if unit > 0:
                res.append(f"lẻ {DIGIT_NAMES[unit]}")
        else:
            if unit > 0:
                res.append(DIGIT_NAMES[unit])
                
    return " ".join(res)

def currency_to_vietnamese_words(amount: float) -> str:
    """
    Convert numeric amount (VND) to Vietnamese words.
    Example: 10360000 -> "Mười triệu ba trăm sáu mươi nghìn đồng"
    """
    amount = int(round(amount))
    if amount == 0:
        return "Không đồng"
    if amount < 0:
        return "Âm " + currency_to_vietnamese_words(abs(amount)).lower()
        
    groups = []
    temp = amount
    while temp > 0:
        groups.append(temp % 1000)
        temp //= 1000
        
    words = []
    for idx, grp in enumerate(groups):
        if grp > 0:
            show_hundred = (idx < len(groups) - 1)
            txt = _read_three_digits(grp, show_zero_hundred=show_hundred)
            unit = UNIT_NAMES[idx] if idx < len(UNIT_NAMES) else ""
            words.insert(0, f"{txt}{unit}")
            
    result = " ".join(words).strip() + " đồng"
    result = result[0].upper() + result[1:]
    # Fix any double spaces
    import re
    result = re.sub(r"\s+", " ", result)
    return result

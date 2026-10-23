// Small, bundled UI vocabulary. Conversation titles and message text are never translated.
const UI_KEYS = 'title search chats fit locate current selected archived user refresh zoom expand collapse choose none loading error'.split(' ');
const UI_ROWS = {
  en: 'Session Tree|Search chats|Chats|Fit all|Locate|Current|Selected|Archived|User|Refresh|Zoom|Expand|Collapse|Choose a chat|No preview|Loading…|Unable to load. Please retry.',
  'zh-Hans': '会话树|搜索会话|个会话|适应全部|定位当前|当前|所选|已归档|用户|刷新|缩放|展开|收起|选择会话|暂无预览|正在读取…|读取失败，请重试。',
  'zh-Hant': '對話樹|搜尋對話|個對話|顯示全部|定位目前|目前|已選|已封存|使用者|重新整理|縮放|展開|收合|選擇對話|暫無預覽|讀取中…|讀取失敗，請重試。',
  de: 'Chatbaum|Chats suchen|Chats|Einpassen|Aktuell|Aktuell|Ausgewählt|Archiviert|Nutzer|Aktualisieren|Zoom|Aufklappen|Zuklappen|Chat auswählen|Keine Vorschau|Wird geladen…|Laden fehlgeschlagen. Bitte erneut versuchen.',
  es: 'Árbol de chats|Buscar chats|Chats|Ajustar|Ubicar|Actual|Seleccionado|Archivado|Usuario|Actualizar|Zoom|Expandir|Contraer|Elegir un chat|Sin vista previa|Cargando…|No se pudo cargar. Inténtalo de nuevo.',
  fr: 'Arbre des chats|Rechercher|Discussions|Ajuster|Centrer|Actuel|Sélectionné|Archivé|Utilisateur|Actualiser|Zoom|Développer|Réduire|Choisir un chat|Aucun aperçu|Chargement…|Échec du chargement. Réessayez.',
  it: 'Albero delle chat|Cerca chat|Chat|Adatta|Centra|Attuale|Selezionata|Archiviata|Utente|Aggiorna|Zoom|Espandi|Comprimi|Scegli una chat|Nessuna anteprima|Caricamento…|Caricamento non riuscito. Riprova.',
  ja: '会話ツリー|会話を検索|会話|全体表示|現在へ|現在|選択中|アーカイブ済み|ユーザー|更新|ズーム|展開|折りたたむ|会話を選択|プレビューなし|読み込み中…|読み込めませんでした。再試行してください。',
  ko: '대화 트리|대화 검색|대화|전체 보기|현재 위치|현재|선택됨|보관됨|사용자|새로고침|확대/축소|펼치기|접기|대화 선택|미리보기 없음|불러오는 중…|불러오지 못했습니다. 다시 시도하세요.',
  pt: 'Árvore de conversas|Buscar conversas|Conversas|Ajustar|Localizar|Atual|Selecionada|Arquivada|Usuário|Atualizar|Zoom|Expandir|Recolher|Escolher conversa|Sem prévia|Carregando…|Não foi possível carregar. Tente novamente.',
  'pt-PT': 'Árvore de conversas|Pesquisar conversas|Conversas|Ajustar|Localizar|Atual|Selecionada|Arquivada|Utilizador|Atualizar|Zoom|Expandir|Recolher|Escolher conversa|Sem pré-visualização|A carregar…|Não foi possível carregar. Tente novamente.',
  ru: 'Дерево чатов|Поиск чатов|Чаты|Вписать|Найти|Текущий|Выбран|В архиве|Пользователь|Обновить|Масштаб|Развернуть|Свернуть|Выбрать чат|Нет предпросмотра|Загрузка…|Не удалось загрузить. Повторите попытку.',
  uk: 'Дерево чатів|Пошук чатів|Чати|Вмістити|Знайти|Поточний|Вибрано|В архіві|Користувач|Оновити|Масштаб|Розгорнути|Згорнути|Вибрати чат|Немає перегляду|Завантаження…|Не вдалося завантажити. Спробуйте ще раз.',
  pl: 'Drzewo czatów|Szukaj czatów|Czaty|Dopasuj|Znajdź|Bieżący|Wybrany|W archiwum|Użytkownik|Odśwież|Powiększenie|Rozwiń|Zwiń|Wybierz czat|Brak podglądu|Ładowanie…|Nie udało się wczytać. Spróbuj ponownie.',
  nl: 'Gespreksboom|Chats zoeken|Chats|Inpassen|Zoeken|Huidig|Geselecteerd|Gearchiveerd|Gebruiker|Vernieuwen|Zoom|Uitvouwen|Invouwen|Kies een chat|Geen voorbeeld|Laden…|Laden mislukt. Probeer het opnieuw.',
  sv: 'Chattträd|Sök chattar|Chattar|Anpassa|Hitta|Aktuell|Vald|Arkiverad|Användare|Uppdatera|Zoom|Visa mer|Visa mindre|Välj en chatt|Ingen förhandsvisning|Läser in…|Kunde inte läsa in. Försök igen.',
  da: 'Chattræ|Søg i chats|Chats|Tilpas|Find|Aktuel|Valgt|Arkiveret|Bruger|Opdater|Zoom|Udvid|Fold sammen|Vælg en chat|Ingen forhåndsvisning|Indlæser…|Kunne ikke indlæse. Prøv igen.',
  nb: 'Chattre|Søk i chatter|Chatter|Tilpass|Finn|Gjeldende|Valgt|Arkivert|Bruker|Oppdater|Zoom|Utvid|Slå sammen|Velg en chat|Ingen forhåndsvisning|Laster…|Kunne ikke laste. Prøv igjen.',
  nn: 'Chattetre|Søk i chattar|Chattar|Tilpass|Finn|Gjeldande|Vald|Arkivert|Brukar|Oppdater|Zoom|Utvid|Slå saman|Vel ein chat|Inga førehandsvising|Lastar…|Kunne ikkje laste. Prøv igjen.',
  fi: 'Keskustelupuu|Hae keskusteluja|Keskustelut|Sovita|Paikanna|Nykyinen|Valittu|Arkistoitu|Käyttäjä|Päivitä|Zoomaus|Laajenna|Kutista|Valitse keskustelu|Ei esikatselua|Ladataan…|Lataus epäonnistui. Yritä uudelleen.',
  cs: 'Strom chatů|Hledat chaty|Chaty|Přizpůsobit|Najít|Aktuální|Vybraný|Archivováno|Uživatel|Obnovit|Přiblížení|Rozbalit|Sbalit|Vybrat chat|Bez náhledu|Načítání…|Načtení se nezdařilo. Zkuste to znovu.',
  sk: 'Strom četov|Hľadať čety|Čety|Prispôsobiť|Nájsť|Aktuálny|Vybraný|Archivované|Používateľ|Obnoviť|Priblíženie|Rozbaliť|Zbaliť|Vybrať čet|Bez ukážky|Načítava sa…|Načítanie zlyhalo. Skúste to znova.',
  sl: 'Drevo klepetov|Išči klepete|Klepeti|Prilagodi|Poišči|Trenutni|Izbran|Arhivirano|Uporabnik|Osveži|Povečava|Razširi|Strni|Izberi klepet|Ni predogleda|Nalaganje…|Nalaganje ni uspelo. Poskusite znova.',
  hr: 'Stablo razgovora|Pretraži razgovore|Razgovori|Prilagodi|Pronađi|Trenutni|Odabrano|Arhivirano|Korisnik|Osvježi|Zumiranje|Proširi|Sažmi|Odaberi razgovor|Nema pregleda|Učitavanje…|Učitavanje nije uspjelo. Pokušajte ponovno.',
  bs: 'Stablo razgovora|Pretraži razgovore|Razgovori|Prilagodi|Pronađi|Trenutni|Odabrano|Arhivirano|Korisnik|Osvježi|Zumiranje|Proširi|Sažmi|Odaberi razgovor|Nema pregleda|Učitavanje…|Učitavanje nije uspjelo. Pokušajte ponovo.',
  sr: 'Стабло разговора|Претражи разговоре|Разговори|Уклопи|Пронађи|Тренутни|Изабрано|Архивирано|Корисник|Освежи|Зумирање|Прошири|Скупи|Изабери разговор|Нема прегледа|Учитавање…|Учитавање није успело. Покушајте поново.',
  'sr-Latn': 'Stablo razgovora|Pretraži razgovore|Razgovori|Uklopi|Pronađi|Trenutni|Izabrano|Arhivirano|Korisnik|Osveži|Zumiranje|Proširi|Skupi|Izaberi razgovor|Nema pregleda|Učitavanje…|Učitavanje nije uspelo. Pokušajte ponovo.',
  hu: 'Beszélgetésfa|Beszélgetések keresése|Beszélgetések|Illesztés|Keresés|Jelenlegi|Kiválasztott|Archivált|Felhasználó|Frissítés|Nagyítás|Kibontás|Összecsukás|Beszélgetés kiválasztása|Nincs előnézet|Betöltés…|Nem sikerült betölteni. Próbálja újra.',
  ro: 'Arbore de conversații|Caută conversații|Conversații|Încadrează|Localizează|Curentă|Selectată|Arhivată|Utilizator|Reîmprospătează|Zoom|Extinde|Restrânge|Alege o conversație|Fără previzualizare|Se încarcă…|Încărcarea a eșuat. Reîncearcă.',
  bg: 'Дърво на разговорите|Търсене на разговори|Разговори|Побери|Намери|Текущ|Избран|Архивиран|Потребител|Опресни|Мащаб|Разгъни|Свий|Избери разговор|Няма преглед|Зареждане…|Неуспешно зареждане. Опитайте отново.',
  el: 'Δέντρο συνομιλιών|Αναζήτηση|Συνομιλίες|Προσαρμογή|Εντοπισμός|Τρέχουσα|Επιλεγμένη|Αρχειοθετημένη|Χρήστης|Ανανέωση|Ζουμ|Ανάπτυξη|Σύμπτυξη|Επιλογή συνομιλίας|Χωρίς προεπισκόπηση|Φόρτωση…|Αποτυχία φόρτωσης. Δοκιμάστε ξανά.',
  tr: 'Sohbet ağacı|Sohbet ara|Sohbetler|Sığdır|Bul|Geçerli|Seçili|Arşivlendi|Kullanıcı|Yenile|Yakınlaştırma|Genişlet|Daralt|Sohbet seç|Önizleme yok|Yükleniyor…|Yüklenemedi. Tekrar deneyin.',
  ar: 'شجرة المحادثات|البحث في المحادثات|المحادثات|ملاءمة|تحديد الموقع|الحالية|المحددة|مؤرشفة|المستخدم|تحديث|التكبير|توسيع|طي|اختر محادثة|لا توجد معاينة|جارٍ التحميل…|تعذر التحميل. حاول مجددًا.',
  he: 'עץ שיחות|חיפוש שיחות|שיחות|התאמה|איתור|נוכחית|נבחרה|בארכיון|משתמש|רענון|זום|הרחבה|צמצום|בחירת שיחה|אין תצוגה מקדימה|בטעינה…|הטעינה נכשלה. נסו שוב.',
  fa: 'درخت گفتگوها|جستجوی گفتگو|گفتگوها|جا دادن|یافتن|فعلی|انتخاب‌شده|بایگانی‌شده|کاربر|تازه‌سازی|بزرگ‌نمایی|گسترش|جمع کردن|انتخاب گفتگو|بدون پیش‌نمایش|در حال بارگیری…|بارگیری نشد. دوباره تلاش کنید.',
  ur: 'گفتگو کا درخت|گفتگو تلاش کریں|گفتگوئیں|فٹ کریں|تلاش کریں|موجودہ|منتخب|محفوظ شدہ|صارف|تازہ کریں|زوم|پھیلائیں|سمیٹیں|گفتگو منتخب کریں|پیش منظر نہیں|لوڈ ہو رہا ہے…|لوڈ نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
  hi: 'बातचीत का पेड़|बातचीत खोजें|बातचीत|फ़िट करें|वर्तमान पर|वर्तमान|चयनित|संग्रहीत|उपयोगकर्ता|रीफ़्रेश|ज़ूम|विस्तार करें|समेटें|बातचीत चुनें|पूर्वावलोकन नहीं|लोड हो रहा है…|लोड नहीं हुआ। फिर कोशिश करें।',
  bn: 'কথোপকথনের গাছ|কথোপকথন খুঁজুন|কথোপকথন|মানানসই|খুঁজুন|বর্তমান|নির্বাচিত|আর্কাইভ করা|ব্যবহারকারী|রিফ্রেশ|জুম|প্রসারিত করুন|সংকুচিত করুন|কথোপকথন বাছুন|প্রাকদর্শন নেই|লোড হচ্ছে…|লোড করা যায়নি। আবার চেষ্টা করুন।',
  gu: 'વાતચીતનું વૃક્ષ|વાતચીત શોધો|વાતચીત|બંધબેસાડો|શોધો|વર્તમાન|પસંદ કરેલ|સંગ્રહિત|વપરાશકર્તા|તાજું કરો|ઝૂમ|વિસ્તારો|સંકોચો|વાતચીત પસંદ કરો|પૂર્વાવલોકન નથી|લોડ થઈ રહ્યું છે…|લોડ થઈ શક્યું નહીં. ફરી પ્રયાસ કરો.',
  mr: 'संभाषण वृक्ष|संभाषण शोधा|संभाषणे|बसवा|शोधा|वर्तमान|निवडलेले|संग्रहित|वापरकर्ता|रिफ्रेश|झूम|विस्तृत करा|संकुचित करा|संभाषण निवडा|पूर्वावलोकन नाही|लोड होत आहे…|लोड झाले नाही. पुन्हा प्रयत्न करा.',
  ta: 'உரையாடல் மரம்|உரையாடலைத் தேடு|உரையாடல்கள்|பொருத்து|கண்டுபிடி|தற்போதைய|தேர்ந்தெடுத்தது|காப்பகப்படுத்தப்பட்டது|பயனர்|புதுப்பி|பெரிதாக்கம்|விரிவாக்கு|சுருக்கு|உரையாடலைத் தேர்ந்தெடு|முன்னோட்டம் இல்லை|ஏற்றுகிறது…|ஏற்ற முடியவில்லை. மீண்டும் முயலவும்.',
  te: 'సంభాషణల చెట్టు|సంభాషణలను వెతకండి|సంభాషణలు|సరిపోల్చు|కనుగొను|ప్రస్తుత|ఎంచుకున్నది|ఆర్కైవ్ చేయబడింది|వినియోగదారు|రిఫ్రెష్|జూమ్|విస్తరించు|కుదించు|సంభాషణను ఎంచుకోండి|ప్రివ్యూ లేదు|లోడ్ అవుతోంది…|లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.',
  kn: 'ಸಂಭಾಷಣೆಗಳ ಮರ|ಸಂಭಾಷಣೆ ಹುಡುಕಿ|ಸಂಭಾಷಣೆಗಳು|ಹೊಂದಿಸಿ|ಹುಡುಕಿ|ಪ್ರಸ್ತುತ|ಆಯ್ಕೆಮಾಡಿದ|ಸಂಗ್ರಹಿಸಲಾಗಿದೆ|ಬಳಕೆದಾರ|ರಿಫ್ರೆಶ್|ಜೂಮ್|ವಿಸ್ತರಿಸಿ|ಕುಗ್ಗಿಸಿ|ಸಂಭಾಷಣೆ ಆಯ್ಕೆಮಾಡಿ|ಮುನ್ನೋಟವಿಲ್ಲ|ಲೋಡ್ ಆಗುತ್ತಿದೆ…|ಲೋಡ್ ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  ml: 'സംഭാഷണ വൃക്ഷം|സംഭാഷണങ്ങൾ തിരയുക|സംഭാഷണങ്ങൾ|യോജിപ്പിക്കുക|കണ്ടെത്തുക|നിലവിലെ|തിരഞ്ഞെടുത്തത്|ആർക്കൈവ് ചെയ്തു|ഉപയോക്താവ്|പുതുക്കുക|സൂം|വികസിപ്പിക്കുക|ചുരുക്കുക|സംഭാഷണം തിരഞ്ഞെടുക്കുക|പ്രിവ്യൂ ഇല്ല|ലോഡ് ചെയ്യുന്നു…|ലോഡ് ചെയ്യാനായില്ല. വീണ്ടും ശ്രമിക്കുക.',
  pa: 'ਗੱਲਬਾਤ ਦਾ ਰੁੱਖ|ਗੱਲਬਾਤ ਖੋਜੋ|ਗੱਲਬਾਤਾਂ|ਫਿੱਟ ਕਰੋ|ਲੱਭੋ|ਮੌਜੂਦਾ|ਚੁਣਿਆ|ਸੰਭਾਲਿਆ|ਵਰਤੋਂਕਾਰ|ਤਾਜ਼ਾ ਕਰੋ|ਜ਼ੂਮ|ਫੈਲਾਓ|ਸਮੇਟੋ|ਗੱਲਬਾਤ ਚੁਣੋ|ਝਲਕ ਨਹੀਂ|ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ…|ਲੋਡ ਨਹੀਂ ਹੋਇਆ। ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  si: 'සංවාද ගස|සංවාද සොයන්න|සංවාද|ගළපන්න|සොයන්න|වත්මන්|තෝරාගත්|සංරක්ෂිත|පරිශීලක|නැවුම් කරන්න|විශාලනය|විහිදන්න|හකුළන්න|සංවාදයක් තෝරන්න|පෙරදසුනක් නැත|පූරණය වෙමින්…|පූරණය කළ නොහැක. නැවත උත්සාහ කරන්න.',
  id: 'Pohon percakapan|Cari percakapan|Percakapan|Sesuaikan|Temukan|Saat ini|Dipilih|Diarsipkan|Pengguna|Segarkan|Zoom|Perluas|Ciutkan|Pilih percakapan|Tanpa pratinjau|Memuat…|Gagal memuat. Coba lagi.',
  ms: 'Pokok perbualan|Cari perbualan|Perbualan|Muatkan|Cari|Semasa|Dipilih|Diarkibkan|Pengguna|Muat semula|Zum|Kembangkan|Runtuhkan|Pilih perbualan|Tiada pratonton|Memuatkan…|Gagal dimuatkan. Cuba lagi.',
  vi: 'Cây hội thoại|Tìm hội thoại|Hội thoại|Vừa khung|Định vị|Hiện tại|Đã chọn|Đã lưu trữ|Người dùng|Làm mới|Thu phóng|Mở rộng|Thu gọn|Chọn hội thoại|Không có bản xem trước|Đang tải…|Không tải được. Vui lòng thử lại.',
  th: 'ต้นไม้บทสนทนา|ค้นหาบทสนทนา|บทสนทนา|พอดี|ค้นหาตำแหน่ง|ปัจจุบัน|ที่เลือก|เก็บถาวรแล้ว|ผู้ใช้|รีเฟรช|ซูม|ขยาย|ยุบ|เลือกบทสนทนา|ไม่มีตัวอย่าง|กำลังโหลด…|โหลดไม่สำเร็จ โปรดลองอีกครั้ง',
  fil: 'Puno ng mga chat|Maghanap ng chat|Mga chat|Iangkop|Hanapin|Kasalukuyan|Napili|Naka-archive|Gumagamit|I-refresh|Zoom|Palawakin|Paliitin|Pumili ng chat|Walang preview|Naglo-load…|Hindi ma-load. Subukang muli.',
  my: 'စကားဝိုင်းသစ်ပင်|စကားဝိုင်းရှာရန်|စကားဝိုင်းများ|အံဝင်အောင်|ရှာရန်|လက်ရှိ|ရွေးထားသော|သိမ်းဆည်းထားသော|အသုံးပြုသူ|ပြန်တင်ရန်|ချဲ့ရန်|ဖြန့်ရန်|ခေါက်ရန်|စကားဝိုင်းရွေးရန်|အစမ်းကြည့်မရှိပါ|တင်နေသည်…|မတင်နိုင်ပါ။ ထပ်စမ်းပါ။',
  km: 'មែកធាងសន្ទនា|ស្វែងរកការសន្ទនា|ការសន្ទនា|សម្របទំហំ|រកទីតាំង|បច្ចុប្បន្ន|បានជ្រើស|បានទុកក្នុងបណ្ណសារ|អ្នកប្រើ|ផ្ទុកឡើងវិញ|ពង្រីក|ពន្លា|បង្រួម|ជ្រើសការសន្ទនា|គ្មានការមើលជាមុន|កំពុងផ្ទុក…|មិនអាចផ្ទុកបាន។ សូមព្យាយាមម្តងទៀត។',
  lo: 'ຕົ້ນໄມ້ການສົນທະນາ|ຄົ້ນຫາການສົນທະນາ|ການສົນທະນາ|ປັບໃຫ້ພໍດີ|ຊອກຫາ|ປັດຈຸບັນ|ເລືອກແລ້ວ|ເກັບໄວ້ແລ້ວ|ຜູ້ໃຊ້|ໂຫຼດໃໝ່|ຊູມ|ຂະຫຍາຍ|ຫຍໍ້|ເລືອກການສົນທະນາ|ບໍ່ມີຕົວຢ່າງ|ກຳລັງໂຫຼດ…|ໂຫຼດບໍ່ໄດ້. ລອງອີກຄັ້ງ.',
  et: 'Vestluste puu|Otsi vestlusi|Vestlused|Mahuta|Leia|Praegune|Valitud|Arhiveeritud|Kasutaja|Värskenda|Suum|Laienda|Ahenda|Vali vestlus|Eelvaade puudub|Laadimine…|Laadimine ebaõnnestus. Proovi uuesti.',
  lv: 'Sarunu koks|Meklēt sarunas|Sarunas|Ietilpināt|Atrast|Pašreizējā|Atlasīta|Arhivēta|Lietotājs|Atjaunināt|Tālummaiņa|Izvērst|Sakļaut|Izvēlēties sarunu|Nav priekšskatījuma|Ielādē…|Neizdevās ielādēt. Mēģiniet vēlreiz.',
  lt: 'Pokalbių medis|Ieškoti pokalbių|Pokalbiai|Sutalpinti|Rasti|Dabartinis|Pasirinktas|Archyvuotas|Naudotojas|Atnaujinti|Mastelis|Išskleisti|Suskleisti|Pasirinkti pokalbį|Nėra peržiūros|Įkeliama…|Nepavyko įkelti. Bandykite dar kartą.',
  is: 'Spjalltré|Leita í spjöllum|Spjöll|Aðlaga|Finna|Núverandi|Valið|Í safni|Notandi|Endurhlaða|Aðdráttur|Stækka|Fella saman|Velja spjall|Engin forskoðun|Hleður…|Ekki tókst að hlaða. Reyndu aftur.',
  ga: 'Crann comhráite|Cuardaigh comhráite|Comhráite|Oiriúnaigh|Aimsigh|Reatha|Roghnaithe|Cartlannaithe|Úsáideoir|Athnuaigh|Zúmáil|Leathnaigh|Laghdaigh|Roghnaigh comhrá|Gan réamhamharc|Á lódáil…|Níor lódáladh. Bain triail eile as.',
  cy: 'Coeden sgyrsiau|Chwilio sgyrsiau|Sgyrsiau|Ffitio|Lleoli|Cyfredol|Dewiswyd|Archifwyd|Defnyddiwr|Adnewyddu|Chwyddo|Ehangu|Cwympo|Dewis sgwrs|Dim rhagolwg|Wrthi’n llwytho…|Methu llwytho. Ceisiwch eto.',
  ca: 'Arbre de converses|Cerca converses|Converses|Ajusta|Localitza|Actual|Seleccionada|Arxivada|Usuari|Actualitza|Zoom|Desplega|Plega|Tria una conversa|Sense previsualització|S’està carregant…|No s’ha pogut carregar. Torna-ho a provar.',
  eu: 'Elkarrizketen zuhaitza|Bilatu elkarrizketak|Elkarrizketak|Egokitu|Aurkitu|Unekoa|Hautatua|Artxibatua|Erabiltzailea|Freskatu|Zooma|Zabaldu|Tolestu|Aukeratu elkarrizketa|Aurrebistarik ez|Kargatzen…|Ezin izan da kargatu. Saiatu berriro.',
  gl: 'Árbore de conversas|Buscar conversas|Conversas|Axustar|Localizar|Actual|Seleccionada|Arquivada|Usuario|Actualizar|Zoom|Expandir|Contraer|Escoller conversa|Sen vista previa|Cargando…|Non se puido cargar. Téntao de novo.',
  sq: 'Pema e bisedave|Kërko biseda|Biseda|Përshtat|Gjej|Aktuale|E zgjedhur|E arkivuar|Përdoruesi|Rifresko|Zmadhimi|Zgjero|Mblidh|Zgjidh bisedë|Pa pamje paraprake|Po ngarkohet…|Ngarkimi dështoi. Provo përsëri.',
  mk: 'Дрво на разговори|Пребарај разговори|Разговори|Вклопи|Најди|Тековен|Избран|Архивиран|Корисник|Освежи|Зумирање|Прошири|Собери|Избери разговор|Нема преглед|Се вчитува…|Не може да се вчита. Обидете се повторно.',
  be: 'Дрэва размоў|Пошук размоў|Размовы|Упісаць|Знайсці|Бягучая|Выбрана|У архіве|Карыстальнік|Абнавіць|Маштаб|Разгарнуць|Згарнуць|Выбраць размову|Няма прагляду|Загрузка…|Не ўдалося загрузіць. Паспрабуйце зноў.',
  hy: 'Զրույցների ծառ|Որոնել զրույցներ|Զրույցներ|Հարմարեցնել|Գտնել|Ընթացիկ|Ընտրված|Արխիվացված|Օգտատեր|Թարմացնել|Մասշտաբ|Բացել|Ծալել|Ընտրել զրույց|Նախադիտում չկա|Բեռնվում է…|Չհաջողվեց բեռնել։ Կրկին փորձեք։',
  ka: 'საუბრების ხე|საუბრების ძიება|საუბრები|მორგება|მოძებნა|მიმდინარე|არჩეული|დაარქივებული|მომხმარებელი|განახლება|მასშტაბი|გაშლა|აკეცვა|აირჩიეთ საუბარი|გადახედვა არ არის|იტვირთება…|ვერ ჩაიტვირთა. სცადეთ ხელახლა.',
  az: 'Söhbət ağacı|Söhbət axtar|Söhbətlər|Uyğunlaşdır|Tap|Cari|Seçilmiş|Arxivlənib|İstifadəçi|Yenilə|Miqyas|Genişləndir|Yığ|Söhbət seç|Önbaxış yoxdur|Yüklənir…|Yüklənmədi. Yenidən cəhd edin.',
  kk: 'Әңгімелер ағашы|Әңгімелерді іздеу|Әңгімелер|Сыйғызу|Табу|Ағымдағы|Таңдалған|Мұрағатталған|Пайдаланушы|Жаңарту|Масштаб|Жаю|Жию|Әңгіме таңдаңыз|Алдын ала көрініс жоқ|Жүктелуде…|Жүктелмеді. Қайталап көріңіз.',
  uz: 'Suhbatlar daraxti|Suhbatlarni qidirish|Suhbatlar|Moslashtirish|Topish|Joriy|Tanlangan|Arxivlangan|Foydalanuvchi|Yangilash|Masshtab|Kengaytirish|Yig‘ish|Suhbat tanlang|Ko‘rib chiqish yo‘q|Yuklanmoqda…|Yuklanmadi. Qayta urinib ko‘ring.',
  mn: 'Харилцан ярианы мод|Яриа хайх|Ярианууд|Багтаах|Олох|Одоогийн|Сонгосон|Архивласан|Хэрэглэгч|Шинэчлэх|Томруулах|Дэлгэх|Хураах|Яриа сонгох|Урьдчилан харах боломжгүй|Ачаалж байна…|Ачаалж чадсангүй. Дахин оролдоно уу.',
  af: 'Gespreksboom|Soek gesprekke|Gesprekke|Pas in|Vind|Huidig|Gekies|Geargiveer|Gebruiker|Verfris|Zoem|Vou uit|Vou in|Kies ’n gesprek|Geen voorskou|Laai tans…|Kon nie laai nie. Probeer weer.',
  am: 'የውይይት ዛፍ|ውይይቶችን ፈልግ|ውይይቶች|አስማማ|ፈልግ|አሁን ያለው|የተመረጠ|በማህደር የተቀመጠ|ተጠቃሚ|አድስ|አጉላ|ዘርጋ|ሰብስብ|ውይይት ምረጥ|ቅድመ እይታ የለም|በመጫን ላይ…|መጫን አልተቻለም። እንደገና ሞክር።',
  sw: 'Mti wa mazungumzo|Tafuta mazungumzo|Mazungumzo|Tosheleza|Tafuta|Ya sasa|Yaliyochaguliwa|Yamehifadhiwa|Mtumiaji|Onyesha upya|Kuza|Panua|Kunja|Chagua mazungumzo|Hakuna hakikisho|Inapakia…|Imeshindwa kupakia. Jaribu tena.',
};

export const supportedUiLocales = Object.keys(UI_ROWS);
export function canonicalUiLocale(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  try { return Intl.getCanonicalLocales(value.replaceAll('_', '-'))[0] || null; } catch { return null; }
}
export function createI18n(requested) {
  const tag = canonicalUiLocale(requested) || 'en';
  const locale = new Intl.Locale(tag), language = locale.language;
  let match = Object.hasOwn(UI_ROWS, tag) ? tag : language;
  if (language === 'zh') match = locale.maximize().script === 'Hant' ? 'zh-Hant' : 'zh-Hans';
  if (language === 'no') match = 'nb';
  if (language === 'tl') match = 'fil';
  if (language === 'sr' && locale.script === 'Latn') match = 'sr-Latn';
  if (!Object.hasOwn(UI_ROWS, match)) match = 'en';
  const values = UI_ROWS[match].split('|');
  const words = Object.fromEntries(UI_KEYS.map((key, i) => [key, values[i]]));
  const number = new Intl.NumberFormat(tag), percent = new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 });
  const t = key => words[key] || key;
  t.locale = match;
  return { locale: match, lang: match === 'en' && language !== 'en' ? 'en' : tag,
    dir: ['ar', 'he', 'fa', 'ur'].includes(language) ? 'rtl' : 'ltr', t,
    count: n => number.format(n) + (language === 'zh' ? ' ' : ' · ') + t('chats'),
    percent: n => percent.format(n) };
}

/**
 * Exporta el contenido del dashboard (contenedor con id "results-export-root") a un PDF.
 * Usa importaciones dinámicas para no inflar el bundle inicial.
 */
export async function exportResultsToPDF(filename = 'test.pdf', testTitle?: string) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf')
  ]);
  
  const root = document.getElementById('results-export-root');
  if (!root) throw new Error('No se encontró el contenedor de resultados');
  
  // Esperar a que el DOM se renderice completamente
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Crear PDF con fondo oscuro
  const pdf = new jsPDF({ 
    orientation: 'p', 
    unit: 'pt', 
    format: 'a4',
    putOnlyUsedFonts: true
  });
  
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - (margin * 2);
  
  // Variables para tracking de páginas
  let currentPageNumber = 1;
  const questionPages: { questionNumber: number; title: string; page: number }[] = [];
  
  // Función para añadir fondo oscuro a cada página
  const addBackground = () => {
    pdf.setFillColor(15, 23, 42); // bg-slate-900
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
  };
  
  // Función para añadir número de página
  const addPageNumber = (pageNum: number) => {
    pdf.setTextColor(148, 163, 184); // text-slate-400
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    const pageText = `${pageNum}`;
    const textWidth = pdf.getTextWidth(pageText);
    pdf.text(pageText, pageWidth - margin - textWidth, pageHeight - 20);
  };
  
  // Portada con nombre de la app
  addBackground();
  
  // Nombre de la app centrado
  pdf.setTextColor(248, 250, 252); // text-slate-50
  pdf.setFontSize(42);
  pdf.setFont('helvetica', 'bold');
  const appName = "TestSolver";
  const appNameWidth = pdf.getTextWidth(appName);
  pdf.text(appName, (pageWidth - appNameWidth) / 2, pageHeight / 2 - 40);
  
  // Título del test si existe
  if (testTitle) {
    pdf.setFontSize(18);
    pdf.setTextColor(199, 210, 254); // indigo-200
    pdf.setFont('helvetica', 'bold');
    const cleanTitle = testTitle.trim();
    const titleLines = pdf.splitTextToSize(cleanTitle, contentWidth - 40);
    const lineHeight = 24;
    let titleY = pageHeight / 2 + 30;
    
    titleLines.forEach((line: string, index: number) => {
      const textWidth = pdf.getTextWidth(line);
      const x = (pageWidth - textWidth) / 2;
      pdf.text(line, x, titleY + (index * lineHeight));
    });
  }
  
  // Fecha y hora
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(148, 163, 184); // text-slate-400
  const date = new Date().toLocaleString('es-ES', {
    year: 'numeric',
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const dateWidth = pdf.getTextWidth(date);
  pdf.text(date, (pageWidth - dateWidth) / 2, pageHeight - 100);
  
  addPageNumber(currentPageNumber++);
  
  // Obtener información de las preguntas para el índice
  const questions = root.querySelectorAll('[data-question-id]') as NodeListOf<HTMLElement>;
  
  if (questions.length === 0) {
    // Fallback: capturar todo el contenido si no hay preguntas individuales
    pdf.addPage();
    addBackground();
    addPageNumber(currentPageNumber++);
    await captureFullContent();
    // Añadir número final de páginas
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      addPageNumber(i);
    }
    pdf.save(filename);
    return;
  }
  
  // Calcular cuántas preguntas caben por página y en qué página estará cada una
  const availableHeight = pageHeight - (margin * 2) - 30; // -30 para número de página
  let currentPageHeight = 0;
  let questionsOnCurrentPage: { element: HTMLElement; questionNumber: number; title: string }[] = [];
  let tempPageNumber = currentPageNumber + 1; // +1 porque el índice ocupará una página
  
  // Pre-calcular todas las alturas y páginas
  for (let i = 0; i < questions.length; i++) {
    const questionEl = questions[i];
    const questionNumber = parseInt(questionEl.getAttribute('data-question-id') || '0');
    
    // Obtener título de la pregunta
    const questionTitle = questionEl.querySelector('h3')?.textContent?.trim() || `Pregunta ${questionNumber}`;
    
    // Medir altura de la pregunta
    const originalOverflow = questionEl.style.overflow;
    questionEl.style.overflow = 'visible';
    
    const tempCanvas = await html2canvas(questionEl, {
      scale: 1.2,
      backgroundColor: '#0f172a',
      useCORS: true,
      logging: false,
      allowTaint: true,
      foreignObjectRendering: false,
      width: questionEl.scrollWidth,
      height: questionEl.scrollHeight
    });
    
    questionEl.style.overflow = originalOverflow;
    
    const ratio = contentWidth / tempCanvas.width;
    const questionHeight = tempCanvas.height * ratio;
    
    // Verificar si cabe en la página actual
    if (currentPageHeight + questionHeight <= availableHeight || questionsOnCurrentPage.length === 0) {
      // Cabe en la página actual
      questionsOnCurrentPage.push({ element: questionEl, questionNumber, title: questionTitle });
      currentPageHeight += questionHeight + 20;
    } else {
      // No cabe, registrar preguntas de la página actual
      questionsOnCurrentPage.forEach(q => {
        questionPages.push({ questionNumber: q.questionNumber, title: q.title, page: tempPageNumber });
      });
      tempPageNumber++;
      
      // Empezar nueva página con esta pregunta
      questionsOnCurrentPage = [{ element: questionEl, questionNumber, title: questionTitle }];
      currentPageHeight = questionHeight + 20;
    }
  }
  
  // Registrar última página
  if (questionsOnCurrentPage.length > 0) {
    questionsOnCurrentPage.forEach(q => {
      questionPages.push({ questionNumber: q.questionNumber, title: q.title, page: tempPageNumber });
    });
  }
  
  // Crear página de índice
  pdf.addPage();
  addBackground();
  
  pdf.setTextColor(248, 250, 252);
  pdf.setFontSize(24);
  pdf.setFont('helvetica', 'bold');
  const indexTitle = "Índice";
  const indexTitleWidth = pdf.getTextWidth(indexTitle);
  pdf.text(indexTitle, (pageWidth - indexTitleWidth) / 2, margin + 40);
  
  // Contenido del índice
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(203, 213, 225); // text-slate-300
  
  let yPos = margin + 100;
  const lineHeight = 20;
  
  questionPages.forEach((item, index) => {
    if (yPos > pageHeight - 100) {
      pdf.addPage();
      addBackground();
      addPageNumber(currentPageNumber++);
      yPos = margin + 40;
    }
    
    const questionText = `${item.title}`;
    const pageText = `${item.page}`;
    const pageTextWidth = pdf.getTextWidth(pageText);
    
    // Título de la pregunta (izquierda)
    pdf.text(questionText, margin, yPos);
    
    // Número de página (derecha)
    pdf.text(pageText, pageWidth - margin - pageTextWidth, yPos);
    
    // Línea de puntos
    const availableSpace = pageWidth - margin - pdf.getTextWidth(questionText) - margin - pageTextWidth - 20;
    const dotCount = Math.floor(availableSpace / 6);
    const dots = '.'.repeat(dotCount);
    pdf.setTextColor(100, 116, 139); // text-slate-500
    pdf.text(dots, margin + pdf.getTextWidth(questionText) + 10, yPos);
    pdf.setTextColor(203, 213, 225); // volver a text-slate-300
    
    yPos += lineHeight;
  });
  
  addPageNumber(currentPageNumber++);
  
  // Ahora renderizar las preguntas reales
  await renderAllQuestions();
  
  // Añadir números de página a todas las páginas
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    addPageNumber(i);
  }
  
  pdf.save(filename);
  
  // Función para renderizar todas las preguntas
  async function renderAllQuestions() {
    const availableHeight = pageHeight - (margin * 2) - 30;
    let currentPageHeight = 0;
    let questionsOnCurrentPage: HTMLElement[] = [];
    
    for (let i = 0; i < questions.length; i++) {
      const questionEl = questions[i];
      
      // Medir altura de la pregunta
      const originalOverflow = questionEl.style.overflow;
      questionEl.style.overflow = 'visible';
      
      const tempCanvas = await html2canvas(questionEl, {
        scale: 1.2,
        backgroundColor: '#0f172a',
        useCORS: true,
        logging: false,
        allowTaint: true,
        foreignObjectRendering: false,
        width: questionEl.scrollWidth,
        height: questionEl.scrollHeight
      });
      
      questionEl.style.overflow = originalOverflow;
      
      const ratio = contentWidth / tempCanvas.width;
      const questionHeight = tempCanvas.height * ratio;
      
      // Verificar si cabe en la página actual
      if (currentPageHeight + questionHeight <= availableHeight || questionsOnCurrentPage.length === 0) {
        // Cabe en la página actual
        questionsOnCurrentPage.push(questionEl);
        currentPageHeight += questionHeight + 20;
      } else {
        // No cabe, renderizar página actual y empezar nueva
        if (questionsOnCurrentPage.length > 0) {
          pdf.addPage();
          addBackground();
          await renderQuestionsPage(questionsOnCurrentPage);
          currentPageNumber++;
        }
        
        // Empezar nueva página con esta pregunta
        questionsOnCurrentPage = [questionEl];
        currentPageHeight = questionHeight + 20;
      }
    }
    
    // Renderizar última página si tiene preguntas
    if (questionsOnCurrentPage.length > 0) {
      pdf.addPage();
      addBackground();
      await renderQuestionsPage(questionsOnCurrentPage);
      currentPageNumber++;
    }
  }
  
  // Función para renderizar un grupo de preguntas en una página
  async function renderQuestionsPage(pageQuestions: HTMLElement[]) {
    let yPosition = margin;
    
    for (const questionEl of pageQuestions) {
      const originalOverflow = questionEl.style.overflow;
      questionEl.style.overflow = 'visible';
      
      try {
        const canvas = await html2canvas(questionEl, {
          scale: 1.2,
          backgroundColor: '#0f172a',
          useCORS: true,
          logging: false,
          allowTaint: true,
          foreignObjectRendering: false,
          width: questionEl.scrollWidth,
          height: questionEl.scrollHeight
        });
        
        const imgData = canvas.toDataURL('image/png');
        const ratio = contentWidth / canvas.width;
        const imgHeight = canvas.height * ratio;
        
        pdf.addImage(imgData, 'PNG', margin, yPosition, contentWidth, imgHeight, undefined, 'FAST');
        yPosition += imgHeight + 20; // Espacio entre preguntas
        
      } catch (error) {
        console.error('Error capturando pregunta:', error);
      } finally {
        questionEl.style.overflow = originalOverflow;
      }
    }
  }
  
  // Función fallback para capturar todo el contenido
  async function captureFullContent() {
    addBackground();
    
    const originalOverflow = root.style.overflow;
    root.style.overflow = 'visible';
    
    const canvas = await html2canvas(root, {
      scale: 1.2,
      backgroundColor: '#0f172a',
      useCORS: true,
      logging: false,
      allowTaint: true,
      foreignObjectRendering: false
    });
    
    root.style.overflow = originalOverflow;
    
    const imgData = canvas.toDataURL('image/png');
    const imgWidth = contentWidth;
    const ratio = imgWidth / canvas.width;
    const imgHeight = canvas.height * ratio;
    
    const availableHeight = pageHeight - (margin * 2);
    let y = 0;
    let remaining = imgHeight;
    
    while (remaining > 0) {
      if (y > 0) {
        pdf.addPage();
        addBackground();
      }
      
      const sliceHeight = Math.min(availableHeight, remaining);
      const sliceHeightPx = sliceHeight / ratio;
      
      const tempCanvas = document.createElement('canvas');
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) break;
      
      tempCanvas.width = canvas.width;
      tempCanvas.height = sliceHeightPx;
      
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      
      ctx.drawImage(
        canvas,
        0, y / ratio, canvas.width, sliceHeightPx,
        0, 0, canvas.width, sliceHeightPx
      );
      
      const partData = tempCanvas.toDataURL('image/png');
      pdf.addImage(partData, 'PNG', margin, margin, imgWidth, sliceHeight, undefined, 'FAST');
      
      y += sliceHeight;
      remaining -= sliceHeight;
    }
  }
  
  pdf.save(filename);
}

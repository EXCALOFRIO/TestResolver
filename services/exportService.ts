import { MODEL_CONFIGS } from '../modelConfigs';

/**
 * Exporta el contenido del dashboard como texto seleccionable en PDF.
 * Versión optimizada que genera texto real en lugar de imágenes.
 */
export async function exportResultsToPDF(filename = 'test.pdf', testTitle?: string) {
  const [{ default: jsPDF }] = await Promise.all([
    import('jspdf')
  ]);
  
  const root = document.getElementById('results-export-root');
  if (!root) throw new Error('No se encontró el contenedor de resultados');
  
  // Crear PDF con texto seleccionable
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
  
  // Función para extraer texto limpio de un elemento
  const extractText = (element: Element): string => {
    return element.textContent?.trim() || '';
  };
  
  // Función para añadir texto con word wrap
  const addWrappedText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number = 14): number => {
    const lines = pdf.splitTextToSize(text, maxWidth);
    lines.forEach((line: string, index: number) => {
      pdf.text(line, x, y + (index * lineHeight));
    });
    return y + (lines.length * lineHeight);
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
  
  // Obtener información de las preguntas
  const questions = root.querySelectorAll('[data-question-id]') as NodeListOf<HTMLElement>;
  
  if (questions.length === 0) {
    pdf.save(filename);
    return;
  }
  
  // Extraer datos de las preguntas para el índice
  const questionsData: Array<{
    id: number;
    title: string;
    text: string;
    options: Array<{ key: string; text: string; votes: number; percentage: number; isWinner: boolean }>;
    confidence: number;
    isResolved: boolean;
  }> = [];
  
  questions.forEach((questionEl, index) => {
    const questionId = parseInt(questionEl.getAttribute('data-question-id') || '0');
    const titleEl = questionEl.querySelector('h3');
    const questionTitle = titleEl ? extractText(titleEl) : `Pregunta ${questionId}`;
    
    // Extraer texto de la pregunta
    const questionTextEl = questionEl.querySelector('p');
    const questionText = questionTextEl ? extractText(questionTextEl) : '';
    
    // Extraer opciones y estadísticas
    const optionElements = questionEl.querySelectorAll('[class*="rounded-lg border"]');
    const options: Array<{ key: string; text: string; votes: number; percentage: number; isWinner: boolean }> = [];
    
    optionElements.forEach(optionEl => {
      const optionText = extractText(optionEl);
      const match = optionText.match(/^([A-Z])\)\s*(.*?)\s*(\d+)\s*votos\s*(\d+)%$/);
      if (match) {
        const [, key, text, votes, percentage] = match;
        const isWinner = optionEl.classList.contains('bg-gradient-to-r') && 
                        (optionEl.classList.contains('from-emerald-500') || optionEl.classList.contains('from-amber-500'));
        options.push({
          key,
          text: text.trim(),
          votes: parseInt(votes),
          percentage: parseInt(percentage),
          isWinner
        });
      }
    });
    
    // Extraer confianza
    const confidenceEl = questionEl.querySelector('[class*="bg-emerald-500"], [class*="bg-amber-500"]');
    const confidenceText = confidenceEl ? extractText(confidenceEl) : '0%';
    const confidence = parseInt(confidenceText.replace('%', '')) || 0;
    
    questionsData.push({
      id: questionId,
      title: questionTitle,
      text: questionText,
      options,
      confidence,
      isResolved: confidence > 0
    });
  });
  
  // Calcular páginas para el índice
  let currentPage = currentPageNumber + 1; // +1 para la página del índice
  questionsData.forEach(q => {
    questionPages.push({
      questionNumber: q.id,
      title: q.title,
      page: currentPage
    });
    currentPage++; // Una página por pregunta para simplificar
  });
  
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
  
  questionPages.forEach((item) => {
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
  
  // Renderizar las preguntas como texto
  questionsData.forEach((question) => {
    pdf.addPage();
    addBackground();
    
    let yPos = margin;
    
    // Título de la pregunta
    pdf.setTextColor(248, 250, 252); // text-slate-50
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    yPos = addWrappedText(question.title, margin, yPos, contentWidth, 22);
    yPos += 20;
    
    // Texto de la pregunta
    pdf.setTextColor(203, 213, 225); // text-slate-300
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    yPos = addWrappedText(question.text, margin, yPos, contentWidth, 16);
    yPos += 30;
    
    // Opciones
    question.options.forEach((option) => {
      // Color de fondo simulado con rectángulo
      if (option.isWinner) {
        pdf.setFillColor(16, 185, 129, 0.2); // emerald con transparencia
        pdf.rect(margin - 5, yPos - 15, contentWidth + 10, 50, 'F');
      }
      
      // Letra de la opción
      pdf.setTextColor(248, 250, 252);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`${option.key})`, margin, yPos);
      
      // Texto de la opción
      pdf.setTextColor(203, 213, 225);
      pdf.setFont('helvetica', 'normal');
      const optionYPos = addWrappedText(option.text, margin + 25, yPos, contentWidth - 120, 16);
      
      // Estadísticas (derecha)
      pdf.setTextColor(148, 163, 184);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const statsText = `${option.votes} votos ${option.percentage}%`;
      const statsWidth = pdf.getTextWidth(statsText);
      pdf.text(statsText, pageWidth - margin - statsWidth, yPos);
      
      // Barra de progreso simulada
      const barWidth = 100;
      const barHeight = 3;
      const barX = pageWidth - margin - barWidth - 10;
      const barY = yPos + 5;
      
      // Fondo de la barra
      pdf.setFillColor(71, 85, 105); // slate-600
      pdf.rect(barX, barY, barWidth, barHeight, 'F');
      
      // Progreso de la barra
      if (option.percentage > 0) {
        const progressWidth = (barWidth * option.percentage) / 100;
        if (option.isWinner) {
          pdf.setFillColor(16, 185, 129); // emerald-500
        } else {
          pdf.setFillColor(99, 102, 241); // indigo-500
        }
        pdf.rect(barX, barY, progressWidth, barHeight, 'F');
      }
      
      yPos = Math.max(optionYPos, yPos) + 35;
    });
    
    // Indicador de confianza
    if (question.isResolved) {
      yPos += 10;
      pdf.setTextColor(148, 163, 184);
      pdf.setFontSize(10);
      pdf.text(`Confianza: ${question.confidence}%`, margin, yPos);
    }
    
    addPageNumber(currentPageNumber++);
  });
  
  pdf.save(filename);
}

/**
 * Versión alternativa que captura el HTML como imagen (backup)
 */
export async function exportResultsAsImage(filename = 'test.pdf', testTitle?: string) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf')
  ]);
  
  const root = document.getElementById('results-export-root');
  if (!root) throw new Error('No se encontró el contenedor de resultados');
  
  // Esperar a que el DOM se renderice completamente
  await new Promise(resolve => setTimeout(resolve, 500));
  
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
  
  // Agregar fondo oscuro
  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, pageWidth, pageHeight, 'F');
  
  // Capturar todo el contenido
  const originalOverflow = root.style.overflow;
  root.style.overflow = 'visible';
  
  const canvas = await html2canvas(root, {
    scale: 1.2,
    backgroundColor: '#0f172a',
    useCORS: true,
    logging: false,
    allowTaint: true,
    foreignObjectRendering: false,
    width: root.scrollWidth,
    height: root.scrollHeight
  });
  
  root.style.overflow = originalOverflow;
  
  const imgData = canvas.toDataURL('image/png');
  const imgWidth = contentWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  
  const availableHeight = pageHeight - (margin * 2);
  
  if (imgHeight <= availableHeight) {
    // La imagen cabe en una página
    pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight, undefined, 'FAST');
  } else {
    // Dividir en múltiples páginas
    let position = 0;
    
    while (position < imgHeight) {
      if (position > 0) {
        pdf.addPage();
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      }
      
      const sliceHeight = Math.min(availableHeight, imgHeight - position);
      
      // Crear un canvas temporal para la porción
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCanvas.width = canvas.width;
      tempCanvas.height = (sliceHeight * canvas.width) / imgWidth;
      
      tempCtx.drawImage(
        canvas,
        0, (position * canvas.width) / imgWidth,
        canvas.width, tempCanvas.height,
        0, 0,
        canvas.width, tempCanvas.height
      );
      
      const partData = tempCanvas.toDataURL('image/png');
      pdf.addImage(partData, 'PNG', margin, margin, imgWidth, sliceHeight, undefined, 'FAST');
      
      position += sliceHeight;
    }
  }
  
  pdf.save(filename);
}

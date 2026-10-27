#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <algorithm>
#include <cassert>
#include <cmath>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

constexpr int W = 400, H = 260;
GLuint compile(GLenum kind, const std::string& source) {
    GLuint shader = glCreateShader(kind);
    const char* ptr = source.c_str();
    glShaderSource(shader, 1, &ptr, nullptr);
    glCompileShader(shader);
    GLint ok;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[8192]; glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
        std::cerr << log << '\n'; std::abort();
    }
    return shader;
}
std::vector<unsigned char> render(const char* file, GLuint background, GLuint mask, bool masked = true, bool joined = false, float joinTop = 0, float refraction = 0, bool reflection = false, float lens = 0, bool panelSlice = false) {
    std::ifstream input(file);
    assert(input.good());
    std::string fragment{std::istreambuf_iterator<char>(input), {}};
    const std::string vertex = R"(#version 300 es
out vec2 v_texcoord;
void main() {
 vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
 v_texcoord = p;
 gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
})";
    GLuint vs = compile(GL_VERTEX_SHADER, vertex), fs = compile(GL_FRAGMENT_SHADER, fragment);
    GLuint program = glCreateProgram();
    glAttachShader(program, vs); glAttachShader(program, fs); glLinkProgram(program);
    GLint ok; glGetProgramiv(program, GL_LINK_STATUS, &ok); assert(ok);
    glUseProgram(program);
    auto f = [&](const char* n, float v) { glUniform1f(glGetUniformLocation(program,n), v); };
    auto i = [&](const char* n, int v) { glUniform1i(glGetUniformLocation(program,n), v); };
    auto v2 = [&](const char* n, float x, float y) { glUniform2f(glGetUniformLocation(program,n), x,y); };
    i("tex",0); i("maskTex",1); i("useMask",masked ? 1 : 0); i("maskMode",0);
    glUniform4f(glGetUniformLocation(program,"joinedRect"), joined ? 40 : 0, joinTop, joined ? 320 : 0, joined ? 41 : 0);
    v2("fullSize",W,H); v2("invFullSize",1.0f/W,1.0f/H);
    v2("glassBoxSizePx",W,H); v2("maskUVScale",1,1); v2("sampleUVScale",1,1);
    v2("glassUVScale",1,1); v2("glassUVOffset",0,0);
    if(panelSlice) {
        v2("fullSize",W*0.5f,H*0.5f); v2("invFullSize",2.0f/W,2.0f/H);
        v2("glassBoxSizePx",W*0.5f,H*0.5f);
        v2("maskUVScale",0.5f,0.5f); v2("maskUVOffset",0.1f,0.2f);
        v2("sampleUVScale",2,2); v2("sampleUVOffset",-0.2f,-0.4f);
    }
    f("lensDistortion",lens);
    f("lensMaxPx",lens*std::min(W,H)*(panelSlice ? 0.5f : 1.0f)*0.006f);
    f("refractionStrength",refraction);
    f("specularStrength",reflection ? 1.0f : 0.0f);
    f("fresnelStrength",reflection ? 0.45f : 0.0f);
    f("roundingPower",2); f("invRoundingPower",0.5);
    f("edgeThickness",0.055); f("invBezelWidthPx",1.0/(H*0.055));
    f("brightness",1); f("contrast",1); f("saturation",1); f("glassOpacity",1);
    f("maskAlphaThreshold",0.08); f("monitorScale",1);
    f("bevelStrength",0.40); f("bevelSize",4); f("bevelAngle",315); f("bevelShadow",0.45);
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,background);
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,mask);
    glViewport(0,0,W,H); glDisable(GL_BLEND);
    glClearColor(0,0,0,0); glClear(GL_COLOR_BUFFER_BIT);
    glDrawArrays(GL_TRIANGLES,0,3); glFinish();
    assert(glGetError()==GL_NO_ERROR);
    std::vector<unsigned char> pixels(W*H*4);
    glReadPixels(0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,pixels.data());
    glDeleteProgram(program); glDeleteShader(vs); glDeleteShader(fs);
    return pixels;
}
int main(int argc,char** argv) {
    assert(argc==4);
    auto getPlatform = reinterpret_cast<PFNEGLGETPLATFORMDISPLAYEXTPROC>(eglGetProcAddress("eglGetPlatformDisplayEXT"));
    assert(getPlatform);
    EGLDisplay display = getPlatform(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr);
    assert(eglInitialize(display,nullptr,nullptr));
    assert(eglBindAPI(EGL_OPENGL_ES_API));
    const EGLint attrs[]={EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_ES3_BIT,EGL_RED_SIZE,8,EGL_GREEN_SIZE,8,EGL_BLUE_SIZE,8,EGL_ALPHA_SIZE,8,EGL_NONE};
    EGLConfig config; EGLint count; assert(eglChooseConfig(display,attrs,&config,1,&count)&&count);
    const EGLint size[]={EGL_WIDTH,W,EGL_HEIGHT,H,EGL_NONE};
    EGLSurface surface=eglCreatePbufferSurface(display,config,size);
    const EGLint version[]={EGL_CONTEXT_CLIENT_VERSION,3,EGL_NONE};
    EGLContext context=eglCreateContext(display,config,EGL_NO_CONTEXT,version);
    assert(eglMakeCurrent(display,surface,surface,context));
    std::vector<unsigned char> background(W*H*4,64),mask(W*H*4,0);
    for(int y=0;y<H;++y) for(int x=0;x<W;++x) {
        int offset=(y*W+x)*4; background[offset+3]=255;
        float qx=std::max(std::abs(x-W/2.0f)-(W/2.0f-64),0.0f);
        float qy=std::max(std::abs(y-H/2.0f)-(H/2.0f-64),0.0f);
        if(std::hypot(qx,qy)<24) {
            mask[offset]=mask[offset+1]=mask[offset+2]=10;
            mask[offset+3]=41;
        }
    }
    const auto initialMask=mask;
    GLuint textures[2]; glGenTextures(2,textures);
    for(int k=0;k<2;++k) {
        glBindTexture(GL_TEXTURE_2D,textures[k]);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
        glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,W,H,0,GL_RGBA,GL_UNSIGNED_BYTE,k?mask.data():background.data());
    }
    auto original=render(argv[1],textures[0],textures[1]);
    auto relief=render(argv[2],textures[0],textures[1]);
    assert(render(argv[1],textures[0],textures[1],false)==render(argv[2],textures[0],textures[1],false));
    int brighter=0,darker=0;
    for(int p=0;p<W*H;++p) {
        int delta=int(relief[p*4])-int(original[p*4]);
        if(delta>15) ++brighter;
        if(delta<-10) ++darker;
        if(mask[p*4+3]==0) assert(relief[p*4+3]==original[p*4+3]);
    }
    int center=(H/2*W+W/2)*4;
    assert(std::abs(int(relief[center])-int(original[center]))<=1);
    assert(brighter>200 && darker==0);
    // A single narrow glint must not become a broad metallic frame or an inset dark band.
    int peaks=0, litWidth=0, previousSign=0;
    for(int x=40;x<58;++x) {
        int value=relief[(130*W+x)*4];
        if(value>relief[center]+10) ++litWidth;
        int delta=int(relief[(130*W+(x+1))*4])-value;
        int sign=(delta>0)-(delta<0);
        if(previousSign>0 && sign<0) ++peaks;
        if(sign) previousSign=sign;
    }
    assert(peaks==1 && litWidth==3);
    // Reflection must illuminate the full glass strip, not disappear after the outer glint.
    auto reflectedRim=render(argv[2],textures[0],textures[1],true,false,0,0,true);
    for(int x=42;x<=43;++x)
        assert(int(reflectedRim[(130*W+x)*4])-int(relief[(130*W+x)*4])>=17);
    assert(std::abs(int(reflectedRim[(130*W+46)*4])-int(relief[(130*W+46)*4]))<=1);
    for(int p=0;p<W*H;++p) assert(reflectedRim[p*4+3]==relief[p*4+3]);
    auto joined=render(argv[2],textures[0],textures[1],true,true);
    int side=(130*W+41)*4;
    int topPeak=0;
    for(int y=41;y<46;++y) {
        topPeak=std::max(topPeak,int(relief[(y*W+200)*4]));
        assert(std::abs(int(joined[(y*W+200)*4])-int(joined[center]))<=1);
    }
    assert(topPeak>int(relief[center])+15);
    assert(joined[side]==relief[side]);
    std::vector<unsigned char> colorPixels(W*H*4);
    std::vector<unsigned char> redRim, blueRim;
    for(int k=0;k<2;++k) {
        for(int p=0;p<W*H;++p) {
            colorPixels[p*4]=k ? 20 : 220;
            colorPixels[p*4+1]=45;
            colorPixels[p*4+2]=k ? 220 : 20;
            colorPixels[p*4+3]=255;
        }
        glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,textures[0]);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
        glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,W,H,0,GL_RGBA,GL_UNSIGNED_BYTE,colorPixels.data());
        auto sampled=render(argv[2],textures[0],textures[1]);
        if(k) blueRim=sampled; else redRim=sampled;
    }
    int rim=(130*W+43)*4;
    assert(redRim[rim]>redRim[rim+2]+50);
    assert(blueRim[rim+2]>blueRim[rim]+50);
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,textures[0]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,background.data());
    std::fill(mask.begin(),mask.end(),0);
    for(int y=0;y<H;++y) for(int x=40;x<360;++x) {
        int p=(y*W+x)*4;
        mask[p]=mask[p+1]=mask[p+2]=10; mask[p+3]=41;
    }
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,textures[1]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,mask.data());
    auto unjoinedBoundary=render(argv[2],textures[0],textures[1]);
    // A monitor-clipped edge has no bevel; the free side still has one.
    assert(std::abs(int(unjoinedBoundary[(W+200)*4])-int(unjoinedBoundary[center]))<=1);
    assert(unjoinedBoundary[(130*W+40)*4]!=unjoinedBoundary[center]);
    auto joinedBoundary=render(argv[2],textures[0],textures[1],true,true,-40);
    assert(unjoinedBoundary[200*4+3]<255 && joinedBoundary[200*4+3]==255);
    for(int p=0;p<W*H;++p) {
        background[p*4]=background[p*4+1]=background[p*4+2]=32;
        background[p*4+3]=128;
    }
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,textures[0]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,background.data());
    auto covered=render(argv[2],textures[0],textures[1]);
    assert(std::abs(int(covered[center])-int(joinedBoundary[center]))<=1);
    std::fill(mask.begin(),mask.end(),0);
    for(int y=0;y<100;++y) for(int x=40;x<360;++x) {
        int p=(y*W+x)*4; mask[p+3]=41;
    }
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,textures[1]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,mask.data());
    auto bar=render(argv[2],textures[0],textures[1]);
    assert(std::abs(int(bar[(W+200)*4])-int(bar[(50*W+200)*4]))<=1);
    assert(bar[(99*W+200)*4]!=bar[(50*W+200)*4]);
    // Fractional edge motion must change the rim smoothly rather than jump by whole texels.
    int distinct=0, previous=-1;
    for(int step=0;step<8;++step) {
        float edge=40.0f+step/8.0f;
        for(int y=0;y<H;++y) for(int x=0;x<W;++x) {
            int p=(y*W+x)*4;
            mask[p+3]=static_cast<unsigned char>(41*std::clamp(x+0.5f-edge,0.0f,1.0f));
        }
        glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,textures[1]);
        glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,mask.data());
        auto fractional=render(argv[2],textures[0],textures[1]);
        int value=fractional[(130*W+41)*4];
        if(previous>=0) assert(std::abs(value-previous)<20);
        if(value!=previous) ++distinct;
        previous=value;
    }
    assert(distinct>=5);
    // The synthetic attached rectangle must not draw an upright rim into the bar.
    std::fill(mask.begin(),mask.end(),0);
    for(int y=0;y<32;++y) for(int x=0;x<W;++x) mask[(y*W+x)*4+3]=41;
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,textures[1]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,mask.data());
    auto barJoin=render(argv[2],textures[0],textures[1],true,true,32);
    for(int y=8;y<19;++y) for(int x=39;x<43;++x)
        assert(std::abs(int(barJoin[(y*W+x)*4])-int(barJoin[(8*W+200)*4]))<=1);
    for(int y=0;y<H;++y) for(int x=0;x<W;++x) {
        int p=(y*W+x)*4;
        background[p]=background[p+1]=background[p+2]=static_cast<unsigned char>(x/2);
        background[p+3]=255;
    }
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,textures[0]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,background.data());
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,textures[1]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,initialMask.data());
    auto flat=render(argv[2],textures[0],textures[1]);
    auto sculpted=render(argv[2],textures[0],textures[1],true,false,0,1.35f);
    assert(flat[center]==sculpted[center]);
    auto windowFlat=render(argv[2],textures[0],textures[1],false);
    auto windowRefracted=render(argv[2],textures[0],textures[1],false,false,0,1.25f);
    assert(windowFlat[center]==windowRefracted[center]);
    assert(std::abs(int(windowFlat[(130*W+10)*4])-int(windowRefracted[(130*W+10)*4]))>=8);
    assert(std::abs(int(flat[(130*W+44)*4])-int(sculpted[(130*W+44)*4]))>=2);
    // The same monitor point must bend identically in differently sized attached surfaces.
    auto fullLens=render(argv[2],textures[0],textures[1],true,false,0,0,false,3.0f);
    auto slicedLens=render(argv[2],textures[0],textures[1],true,false,0,0,false,3.0f,true);
    assert(std::abs(int(fullLens[(116*W+89)*4])-int(slicedLens[(129*W+99)*4]))<=1);

    // The central reflection is subtle, preserves alpha, and stays behind opaque content.
    auto reflected=render(argv[2],textures[0],textures[1],true,false,0,0,true);
    int centralLift=int(reflected[center])-int(flat[center]);
    assert(centralLift>=2 && centralLift<=8);
    assert(reflected[center+3]==flat[center+3]);
    auto windowReflected=render(argv[2],textures[0],textures[1],false,false,0,0,true);
    assert(int(windowReflected[center])>int(windowFlat[center]));
    assert(windowReflected[center+3]==windowFlat[center+3]);
    std::fill(mask.begin(),mask.end(),64);
    for(int p=0;p<W*H;++p) mask[p*4+3]=255;
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,textures[1]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,mask.data());
    auto opaque=render(argv[2],textures[0],textures[1]);
    auto opaqueReflected=render(argv[2],textures[0],textures[1],true,false,0,0,true);
    assert(opaque[center]==opaqueReflected[center]);
    // A striped backdrop reveals interior refraction away from the rim, without moving the mask.
    for(int y=0;y<H;++y) for(int x=0;x<W;++x) {
        int p=(y*W+x)*4;
        background[p]=background[p+1]=background[p+2]=((x/8)%2) ? 220 : 32;
        background[p+3]=255;
    }
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,textures[0]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,background.data());
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,textures[1]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,initialMask.data());
    auto bodyFlat=render(argv[2],textures[0],textures[1]);
    auto bodyLens=render(argv[2],textures[0],textures[1],true,false,0,0,false,0.24f);
    assert(std::abs(int(bodyFlat[(130*W+79)*4])-int(bodyLens[(130*W+79)*4]))>=20);
    for(int p=0;p<W*H;++p) assert(bodyFlat[p*4+3]==bodyLens[p*4+3]);
    // The four-pixel shell rim exposes glass like the window exterior, without changing the body.
    for(int p=0;p<W*H;++p) {
        background[p*4]=background[p*4+1]=background[p*4+2]=230;
        background[p*4+3]=255;
    }
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,textures[0]);
    glTexSubImage2D(GL_TEXTURE_2D,0,0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,background.data());
    auto lightGlass=render(argv[2],textures[0],textures[1]);
    int lightEdge=255;
    for(int x=41;x<45;++x) lightEdge=std::min(lightEdge,int(lightGlass[(130*W+x)*4]));
    assert(lightEdge>int(lightGlass[center])+6);
    assert(lightEdge<=230);
    assert(lightGlass[(130*W+42)*4]>lightGlass[center]+6);
    assert(lightGlass[(130*W+42)*4]<=230);
    assert(lightGlass[(130*W+45)*4]==lightGlass[center]);
    assert(lightGlass[(130*W+60)*4]==lightGlass[center]);
    for(int p=0;p<W*H;++p) assert(lightGlass[p*4+3]==bodyFlat[p*4+3]);
    for(int k=0;k<2;++k) {
        std::ofstream out(std::string(argv[3])+(k?"-relief.ppm":"-original.ppm"),std::ios::binary);
        out<<"P6\n"<<W<<' '<<H<<"\n255\n";
        const auto& pixels=k?relief:original;
        for(int y=0;y<H;++y) for(int x=0;x<W;++x) out.write(reinterpret_cast<const char*>(&pixels[(y*W+x)*4]),3);
    }
    std::cout<<"Contour relief passed: "<<brighter<<" lit pixels, "<<darker<<" shadow pixels; center and transparent exterior unchanged\n";
    eglTerminate(display);
}
